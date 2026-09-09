import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { defaultTradeQuoteTotal, persistedOverallDiscountUnitPrice, overallTradeQuoteDiscountKind } from '../../../src/lib/trade-quote';
import { apiRequest } from '@/lib/api';
import { colours, radius, spacing } from '@/lib/theme';
import { FieldButton } from './field-button';
import { FieldSelect } from './field-select';
import type { FieldPermissions } from './job-work-selection';

type Line = { description: string; quantity: string; unitPrice: string; taxCode: string; lineType: string; sectionHeading: string; priceBookItemId?: string; jobPacketId?: string; jobPacketLineId?: string };
type SavedLine = Omit<Line, 'quantity' | 'unitPrice'> & { quantityMilli: number; unitPriceCents: number; totalCents: number };
type SavedChoice = { clientKey: string; kind: string; groupKey: string; name: string; summary: string; recommended: boolean; items: SavedLine[]; totalCents: number };
type QuoteVersion = { id: string; versionNumber: number; status: string; customerEmail: string; terms: string; customerMessage: string; validUntil: string; items: SavedLine[]; choices: SavedChoice[]; totalCents: number; updatedAt: string };
type Quote = { quoteNumber: string; currentVersionNumber: number; status: string; versions: QuoteVersion[]; editableDraft: { id: string } | null; link: { shareUrl: string; pdfUrl: string; status: string } | null; deliveries: { status: string; presentation?: { label: string } }[] };
type PriceItem = { id: string; name: string; sellPriceCentsExGst: number; taxCode: string; lineType?: string };
type QuoteResult = { quote: Quote | null; authorisedEmails?: string[]; priceBookItems?: PriceItem[]; draftVersionId?: string; business?: { quoteDefaultTerms: string }; access?: { canManageQuotes: boolean; canSendQuotes: boolean }; delivery?: { status?: string; message?: string } };
type InvoiceLine = { description: string; unitPriceCentsExGst: number; taxCode: string; priceBookItemId: string };
type Invoice = { id: string; invoiceNumber: string; status: string; revision: number; lines: InvoiceLine[]; discountCents: number; dueAt: string; totalCents: number; deliveryStatus: string; deliveryEmail: string; canCorrect: boolean; canDownloadPdf: boolean };
type InvoiceQuoteTemplate = { quoteId: string; quoteVersionId: string; quoteNumber: string; versionNumber: number; status: string; terms: string; lines: InvoiceLine[]; discountCents: number; totalCents: number };
type InvoiceResult = { invoice: Invoice | null; acceptedInvoice: { invoiceNumber: string; status: string; totalCents: number; issueBlockerCode?: string } | null; quoteTemplate?: InvoiceQuoteTemplate | null; access?: { canManageInvoices: boolean; canViewPriceBook: boolean } };
const blank = (): Line => ({ description: '', quantity: '1', unitPrice: '', taxCode: 'gst', lineType: 'product', sectionHeading: 'Included work' });
const editLine = (line: SavedLine): Line => ({ ...line, quantity: String(line.quantityMilli / 1000), unitPrice: persistedOverallDiscountUnitPrice(line) });
const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value / 100);
function cents(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a positive amount with no more than two decimal places.');
  const [whole, part = ''] = value.trim().split('.');
  return Number(whole) * 100 + Number(part.padEnd(2, '0'));
}
function futureDate(days: number) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function FieldCommercialWorkspace({ workOrderId, selected, onSelect, online, protectedJob }: {
  workOrderId: string; selected: string | null; onSelect: (value: string | null) => void; online: boolean; protectedJob: boolean;
}) {
  const [permissions, setPermissions] = useState<FieldPermissions | null>(null);
  const [accessError, setAccessError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!online || protectedJob) return;
    const controller = new AbortController();
    void apiRequest<{ permissions: FieldPermissions | null }>('/api/field/access', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setPermissions(result.permissions); setAccessError(''); } })
      .catch((error) => { if (!controller.signal.aborted) { setPermissions(null); setAccessError(error instanceof Error ? error.message : 'Could not check Team access.'); } });
    return () => controller.abort();
  }, [online, protectedJob, attempt, workOrderId]);
  if (protectedJob) return null;
  if (!online && !selected) return <Text style={styles.help}>Reconnect to check quoting and invoicing access.</Text>;
  if (accessError && !selected) return <View style={styles.card}><Text style={styles.error}>{accessError}</Text><FieldButton variant="secondary" onPress={() => setAttempt((value) => value + 1)}>Check commercial access</FieldButton></View>;
  if (selected === 'quote' || selected === 'invoice') return <CommercialEditor key={`${workOrderId}:${selected}`} workOrderId={workOrderId} kind={selected} onBack={() => onSelect(null)} online={online} permissions={permissions} />;
  if (selected || !permissions || (!permissions.canViewQuotes && !permissions.canViewInvoices)) return null;
  return <View style={styles.card}><Text style={styles.title}>Quotes and invoices</Text><View style={styles.row}>
    {permissions.canViewQuotes ? <FieldButton style={styles.flex} variant="secondary" onPress={() => onSelect('quote')}>Quote</FieldButton> : null}
    {permissions.canViewInvoices ? <FieldButton style={styles.flex} variant="secondary" onPress={() => onSelect('invoice')}>Invoice</FieldButton> : null}
  </View></View>;
}

function CommercialEditor({ workOrderId, kind, onBack, online, permissions }: {
  workOrderId: string; kind: 'quote' | 'invoice'; onBack: () => void; online: boolean; permissions: FieldPermissions | null;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [acceptedInvoice, setAcceptedInvoice] = useState<InvoiceResult['acceptedInvoice']>(null);
  const [invoiceQuoteTemplate, setInvoiceQuoteTemplate] = useState<InvoiceQuoteTemplate | null>(null);
  const [usingInvoiceQuote, setUsingInvoiceQuote] = useState(false);
  const [invoiceDiscountCents, setInvoiceDiscountCents] = useState(0);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [choices, setChoices] = useState<SavedChoice[]>([]);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [emailOptions, setEmailOptions] = useState<string[]>([]);
  const [customerEmail, setCustomerEmail] = useState('');
  const [terms, setTerms] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState(() => futureDate(kind === 'quote' ? 30 : 14));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('load');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [serverCanManage, setServerCanManage] = useState(false);
  const [serverCanSend, setServerCanSend] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const navigation = useNavigation();
  usePreventRemove(dirty || busy === 'save' || busy === 'send', ({ data }) => {
    if (busy) return Alert.alert('Please wait', 'Wait for this save or send to finish before leaving.');
    Alert.alert('Unsaved document', 'Save the draft before leaving, or discard your unsaved edits.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard edits', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  const endpoint = kind === 'quote' ? '/api/trade-quotes' : '/api/trade-quick-invoices';
  const applyQuote = useCallback((result: QuoteResult) => {
    setQuote(result.quote); setServerCanManage(result.access?.canManageQuotes === true); setServerCanSend(result.access?.canSendQuotes === true);
    if (result.authorisedEmails) setEmailOptions(result.authorisedEmails);
    if (result.priceBookItems) setPriceItems(result.priceBookItems);
    const version = result.quote?.versions.find((item) => item.id === result.quote?.editableDraft?.id)
      || result.quote?.versions.find((item) => item.versionNumber === result.quote?.currentVersionNumber);
    setLines(version ? version.items.map(editLine) : [blank()]); setChoices(version?.choices || []);
    setCustomerEmail(version?.customerEmail || result.authorisedEmails?.[0] || '');
    setTerms(version?.terms || result.business?.quoteDefaultTerms || ''); setMessage(version?.customerMessage || '');
    setDate(version?.validUntil || futureDate(30)); setDirty(false); setLoaded(true);
  }, []);
  const applyInvoice = useCallback((result: InvoiceResult) => {
    setInvoice(result.invoice); setAcceptedInvoice(result.acceptedInvoice); setServerCanManage(result.access?.canManageInvoices === true);
    setServerCanSend(result.access?.canManageInvoices === true);
    const quoteTemplate = !result.invoice && !result.acceptedInvoice ? result.quoteTemplate || null : null;
    const sourceLines = result.invoice?.lines || quoteTemplate?.lines;
    setInvoiceQuoteTemplate(quoteTemplate); setUsingInvoiceQuote(Boolean(quoteTemplate));
    setLines(sourceLines?.map((item) => ({ ...blank(), description: item.description, unitPrice: (item.unitPriceCentsExGst / 100).toFixed(2), taxCode: item.taxCode, priceBookItemId: item.priceBookItemId })) || [blank()]);
    setInvoiceDiscountCents(result.invoice?.discountCents || quoteTemplate?.discountCents || 0);
    setTerms(quoteTemplate?.terms || '');
    setDate(result.invoice?.dueAt || futureDate(14)); setDirty(false); setLoaded(true);
  }, []);
  const load = useCallback((signal?: AbortSignal) => {
    const path = `${endpoint}?workOrderId=${encodeURIComponent(workOrderId)}`;
    const request = kind === 'quote'
      ? apiRequest<QuoteResult>(path, { signal }).then((result) => { if (!signal?.aborted) applyQuote(result); })
      : apiRequest<InvoiceResult>(path, { signal }).then((result) => { if (!signal?.aborted) applyInvoice(result); });
    return request.catch((caught) => { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : 'Could not open this document.'); })
      .finally(() => { if (!signal?.aborted) setBusy(''); });
  }, [workOrderId, kind, endpoint, applyQuote, applyInvoice]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const version = quote?.versions.find((item) => item.id === quote.editableDraft?.id)
    || quote?.versions.find((item) => item.versionNumber === quote.currentVersionNumber);
  const savedTotal = kind === 'quote' ? defaultTradeQuoteTotal(version?.totalCents || 0, version?.choices || []) : invoice?.totalCents || (usingInvoiceQuote ? invoiceQuoteTemplate?.totalCents || 0 : 0);
  const canEdit = online && loaded && serverCanManage && !busy && !acceptedInvoice && (kind === 'quote' || !invoice || invoice.canCorrect);
  function change(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
    if (kind === 'invoice') { setUsingInvoiceQuote(false); setInvoiceDiscountCents(0); }
    setDirty(true); setStatus('');
  }
  async function save() {
    if (!canEdit) return;
    setBusy('save'); setError(''); setStatus('');
    try {
      if (kind === 'quote') {
        const result = await apiRequest<QuoteResult>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'save_draft', workOrderId, lines,
          expectedVersionId: version?.id || '', expectedUpdatedAt: version?.updatedAt || '',
          choices: choices.map(({ items, ...choice }) => ({ ...choice, lines: items.map(editLine) })), customerEmail, terms, customerMessage: message, validUntil: date }) });
        applyQuote({ ...result, authorisedEmails: emailOptions, priceBookItems: priceItems });
      } else {
        const createFromQuote = !invoice && usingInvoiceQuote && invoiceQuoteTemplate;
        const result = await apiRequest<InvoiceResult>(endpoint, { method: 'POST', body: JSON.stringify({ action: invoice ? 'correct_draft' : createFromQuote ? 'create_from_quote' : 'create_draft', workOrderId, invoiceId: invoice?.id,
          quoteVersionId: createFromQuote ? invoiceQuoteTemplate.quoteVersionId : undefined,
          expectedRevision: invoice?.revision, dueAt: date, discountCents: invoiceDiscountCents,
          lines: lines.map((line) => ({ description: line.description, unitPriceCentsExGst: cents(line.unitPrice), taxCode: line.taxCode, priceBookItemId: line.priceBookItemId || '' })) }) });
        applyInvoice(result);
      }
      setStatus('Draft saved. Review the saved totals before sending.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The draft was not saved.'); }
    finally { setBusy(''); }
  }
  async function send() {
    if (dirty || !online || !serverCanSend || busy) return;
    const recipient = kind === 'quote' ? version?.customerEmail : invoice?.deliveryEmail;
    if (!recipient) return setError('An authorised customer email is required before sending.');
    Alert.alert(`Send ${kind}`, `Send the saved ${kind} for ${money(savedTotal)} to ${recipient}?${choices.length ? '\nThis total includes the default options. The customer can choose from the saved alternatives.' : ''}\nOnly continue if the customer requested it.`, [
      { text: 'Review again', style: 'cancel' }, { text: 'Confirm and send', onPress: () => { void (async () => {
        setBusy('send'); setError('');
        try {
          if (kind === 'quote') {
            const action = version?.status === 'draft' ? 'issue_quote' : 'send_quote';
            const result = await apiRequest<QuoteResult>(endpoint, { method: 'POST', body: JSON.stringify({ action, workOrderId, quoteVersionId: version?.id, expectedUpdatedAt: version?.updatedAt, consentConfirmed: true }) });
            applyQuote({ ...result, authorisedEmails: emailOptions, priceBookItems: priceItems });
            setStatus(result.delivery?.message || `Email status: ${result.delivery?.status || result.quote?.deliveries[0]?.status || 'Check the saved delivery record'}.`);
          } else {
            const result = await apiRequest<InvoiceResult>(endpoint, { method: 'POST', body: JSON.stringify({ action: 'retry_delivery', workOrderId, invoiceId: invoice?.id, expectedRevision: invoice?.revision, expectedRecipient: recipient, consentConfirmed: true }) });
            applyInvoice(result); setStatus(`Email status: ${result.invoice?.deliveryStatus || 'Check the saved delivery record'}.`);
          }
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Delivery could not be confirmed. Reload before trying again.'); }
        finally { setBusy(''); }
      })(); } },
    ]);
  }
  async function savePriceItem(line: Line) {
    if (!permissions?.canManagePriceBook || !canEdit) return;
    setBusy('price'); setError('');
    try {
      const result = await apiRequest<{ item: PriceItem }>('/api/trade-price-book', { method: 'POST', body: JSON.stringify({ action: 'create', name: line.description, description: line.description, itemType: line.lineType === 'labour' ? 'labour' : 'material', unitLabel: 'each', supplierCost: '0', sellPrice: line.unitPrice, taxCode: line.taxCode }) });
      setPriceItems((current) => [...current, result.item]); setStatus('Item saved in your price book.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The price-book item was not saved.'); }
    finally { setBusy(''); }
  }
  function back() {
    if (!dirty) return onBack();
    Alert.alert('Unsaved document', 'Save the draft before leaving, or discard your unsaved edits.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard edits', style: 'destructive', onPress: onBack }]);
  }
  function startBlankInvoice() {
    setUsingInvoiceQuote(false); setLines([blank()]); setInvoiceDiscountCents(0); setTerms(''); setDate(futureDate(14)); setDirty(false);
    setError(''); setStatus('Blank invoice ready.');
  }
  function restoreQuoteInvoice() {
    if (!invoiceQuoteTemplate) return;
    setUsingInvoiceQuote(true);
    setLines(invoiceQuoteTemplate.lines.map((item) => ({ ...blank(), description: item.description, unitPrice: (item.unitPriceCentsExGst / 100).toFixed(2), taxCode: item.taxCode, priceBookItemId: item.priceBookItemId })));
    setInvoiceDiscountCents(invoiceQuoteTemplate.discountCents); setTerms(invoiceQuoteTemplate.terms); setDate(futureDate(14)); setDirty(false);
    setError(''); setStatus(`${invoiceQuoteTemplate.quoteNumber} is ready to invoice.`);
  }
  return <View style={styles.card}>
    <FieldButton variant="secondary" disabled={Boolean(busy)} onPress={back}>Job</FieldButton>
    <Text style={styles.title}>{kind === 'quote' ? quote?.quoteNumber || 'Quick quote' : invoice?.invoiceNumber || acceptedInvoice?.invoiceNumber || 'Quick invoice'}</Text>
    {busy === 'load' ? <Text style={styles.help}>Opening saved records...</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={styles.help}>{status}</Text> : null}
    {acceptedInvoice ? <><Text style={styles.text}>Invoice from the accepted quote: {money(acceptedInvoice.totalCents)} | {acceptedInvoice.status}</Text><Text style={styles.help}>This job already has its invoice. A second invoice cannot be created.</Text></> : loaded ? <>
      {kind === 'invoice' && !invoice && invoiceQuoteTemplate ? <View style={styles.line}>
        <Text style={styles.label}>{usingInvoiceQuote ? `Using latest quote ${invoiceQuoteTemplate.quoteNumber}` : 'Blank invoice selected'}</Text>
        {usingInvoiceQuote ? <>
          <Text style={styles.text}>{money(invoiceQuoteTemplate.totalCents)} including GST</Text>
          {invoiceQuoteTemplate.discountCents ? <Text style={styles.help}>Includes the saved quote discount of {money(invoiceQuoteTemplate.discountCents)} before GST.</Text> : null}
          {invoiceQuoteTemplate.terms ? <Text style={styles.help}>Quote terms: {invoiceQuoteTemplate.terms}</Text> : null}
        </> : null}
        <FieldButton variant="secondary" onPress={usingInvoiceQuote ? startBlankInvoice : restoreQuoteInvoice}>{usingInvoiceQuote ? 'Start a blank invoice instead' : `Use ${invoiceQuoteTemplate.quoteNumber}`}</FieldButton>
      </View> : null}
      <Text style={styles.help}>{kind === 'invoice' ? 'Enter each line amount before GST.' : 'Enter unit prices before GST.'}</Text>
      {lines.map((line, index) => <View key={index} style={styles.line}>
        <Text style={styles.label}>Line {index + 1}</Text>
        {kind === 'quote' && priceItems.length && canEdit ? <FieldSelect label="Price-book item" value={line.priceBookItemId || ''} options={[{ value: '', label: 'Custom line' }, ...priceItems.map((item) => ({ value: item.id, label: `${item.name} | ${money(item.sellPriceCentsExGst)}` }))]} onChange={(value) => {
          const item = priceItems.find((candidate) => candidate.id === value);
          change(index, item ? { priceBookItemId: item.id, description: item.name, unitPrice: (item.sellPriceCentsExGst / 100).toFixed(2), taxCode: item.taxCode, lineType: item.lineType || 'product' } : { priceBookItemId: '' });
        }} /> : null}
        <Input label="Description" value={line.description} editable={canEdit && !line.priceBookItemId} onChange={(value) => change(index, { description: value })} />
        {kind === 'quote' && !overallTradeQuoteDiscountKind(line) ? <Input label="Quantity" value={line.quantity} editable={canEdit} onChange={(value) => change(index, { quantity: value })} numeric /> : null}
        {overallTradeQuoteDiscountKind(line) === 'percent' ? <Text style={styles.help}>Overall discount: {Number(line.quantity) * 100}%</Text> : <Input label={overallTradeQuoteDiscountKind(line) === 'fixed' ? 'Overall discount, including GST' : kind === 'quote' ? 'Unit price, ex GST' : 'Line amount, ex GST'} value={line.unitPrice} editable={canEdit && !line.priceBookItemId && (!overallTradeQuoteDiscountKind(line) || permissions?.canApplyDiscounts === true)} onChange={(value) => change(index, { unitPrice: value })} numeric />}
        <FieldSelect label="Tax" value={line.taxCode} disabled={!canEdit || Boolean(line.priceBookItemId)} options={[{ value: 'gst', label: 'GST 10%' }, { value: 'none', label: 'No GST' }]} onChange={(value) => change(index, { taxCode: value })} />
        {canEdit ? <View style={styles.row}>{lines.length > 1 || choices.length ? <FieldButton variant="quiet" onPress={() => { setLines((current) => current.filter((_, i) => i !== index)); if (kind === 'invoice') { setUsingInvoiceQuote(false); setInvoiceDiscountCents(0); } setDirty(true); }}>Remove</FieldButton> : null}
          {permissions?.canManagePriceBook && !line.priceBookItemId && line.description.trim() && Number(line.unitPrice) > 0 ? <FieldButton variant="quiet" onPress={() => void savePriceItem(line)}>Save price-book item</FieldButton> : null}</View> : null}
      </View>)}
      {canEdit && lines.length < 8 ? <FieldButton variant="secondary" onPress={() => { setLines((current) => [...current, blank()]); if (kind === 'invoice') { setUsingInvoiceQuote(false); setInvoiceDiscountCents(0); } setDirty(true); }}>Add line</FieldButton> : null}
      {choices.map((choice) => <View key={choice.clientKey} style={styles.line}><Text style={styles.label}>{choice.name} | {money(choice.totalCents)}</Text>{choice.items.map((item, index) => <Text key={index} style={styles.text}>{item.description} | {money(item.totalCents)}</Text>)}<Text style={styles.help}>Saved alternative retained with this quote.</Text></View>)}
      {kind === 'quote' ? <>
        <FieldSelect label="Customer email" value={customerEmail} disabled={!canEdit} options={emailOptions.map((email) => ({ value: email, label: email }))} onChange={(value) => { setCustomerEmail(value); setDirty(true); }} />
        <Input label="Customer message" value={message} editable={canEdit} onChange={(value) => { setMessage(value); setDirty(true); }} multiline />
        <Input label="Terms" value={terms} editable={canEdit} onChange={(value) => { setTerms(value); setDirty(true); }} multiline />
      </> : null}
      <Input label={kind === 'quote' ? 'Valid until, YYYY-MM-DD' : 'Due date, YYYY-MM-DD'} value={date} editable={canEdit} onChange={(value) => { setDate(value); setDirty(true); }} />
      {canEdit ? <FieldButton onPress={() => void save()}>{kind === 'invoice' && !invoice && usingInvoiceQuote && invoiceQuoteTemplate ? `Create invoice from ${invoiceQuoteTemplate.quoteNumber}` : 'Save draft'}</FieldButton> : null}
      {version || invoice ? <View style={styles.line}><Text style={styles.label}>{dirty ? 'Previously saved total' : choices.length ? 'Saved total with default options, including GST' : 'Saved total including GST'}</Text><Text style={styles.total}>{money(savedTotal)}</Text><Text style={styles.help}>{kind === 'quote' ? version?.status : `${invoice?.status} | email ${invoice?.deliveryStatus}`}</Text></View> : null}
      {serverCanSend && (version || invoice) ? <FieldButton disabled={dirty || Boolean(busy) || !online} onPress={() => void send()}>Review and send saved {kind}</FieldButton> : null}
      {kind === 'quote' && quote?.link?.pdfUrl ? <FieldButton variant="secondary" onPress={() => void Linking.openURL(quote.link!.pdfUrl)}>Open issued PDF</FieldButton> : null}
    </> : null}
    <FieldButton variant="quiet" disabled={Boolean(busy) || dirty || !online} onPress={() => { setBusy('load'); setError(''); void load(); }}>Reload saved record</FieldButton>
  </View>;
}
function Input({ label, value, onChange, editable, numeric = false, multiline = false }: { label: string; value: string; onChange: (value: string) => void; editable: boolean; numeric?: boolean; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={editable} keyboardType={numeric ? 'decimal-pad' : 'default'} multiline={multiline} maxLength={multiline ? 4000 : 500} style={[styles.input, multiline && styles.multiline]} placeholderTextColor={colours.muted} /></View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colours.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, borderColor: colours.line, borderWidth: 1 },
  title: { color: colours.ink, fontSize: 21, fontWeight: '800' }, label: { color: colours.ink, fontSize: 15, fontWeight: '700' },
  text: { color: colours.ink, fontSize: 16 }, help: { color: colours.muted, fontSize: 14, lineHeight: 21 }, error: { color: colours.red, fontSize: 16 },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }, flex: { flex: 1 }, field: { gap: spacing.xs },
  line: { gap: spacing.sm, paddingVertical: spacing.sm, borderBottomColor: colours.line, borderBottomWidth: 1 },
  input: { backgroundColor: colours.surfaceRaised, color: colours.ink, fontSize: 16, borderRadius: radius.sm, padding: spacing.md, borderWidth: 1, borderColor: colours.line, minHeight: 48 },
  multiline: { minHeight: 90, textAlignVertical: 'top' }, total: { color: colours.green, fontSize: 27, fontWeight: '800' },
});
