import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FieldButton } from '@/components/field-button';
import { FieldCommercialWorkspace } from '@/components/field-commercial-workspace';
import { FieldSelect } from '@/components/field-select';
import type { FieldJobOptions } from '@/components/job-work-selection';
import { Screen } from '@/components/screen';
import { apiRequest } from '@/lib/api';
import { colours, radius, spacing } from '@/lib/theme';
import { useApp } from '@/providers/app-provider';

type CommercialKind = 'quote' | 'invoice';
type Stage = 'find' | 'new-customer' | 'work' | 'editor';
type CustomerMatch = {
  customerId: string; customerNumber: string; customerType: string; displayName: string;
  firstName: string; lastName: string; businessName: string; email: string; phone: string;
  serviceSiteId: string; siteLabel: string; addressLine1: string; addressLine2: string;
  suburb: string; addressState: string; postcode: string;
};
type JobMatch = {
  id: string; title: string; stage: string; customerSource: string;
  jobRegister: {
    jobId: string; firstName: string; lastName: string; contactNumber: string; email: string;
    streetAddress: string; suburb: string; state: string; postcode: string; service: string;
  };
};
type JobSearchResult = {
  items: JobMatch[];
  access?: { permissions?: { canManageInvoices?: boolean } };
};
type AddressPrediction = { id: string; label: string; provider: string };
type AddressSelection = {
  id: string; label: string; addressLine1: string; addressLine2: string;
  suburb: string; addressState: string; postcode: string;
  provider: string; providerReference: string; formattedAddress: string; selectionProof: string;
};
type AddressProvenance = {
  entryMode: 'manual_pending_review' | 'provider_selected';
  provider: string; providerReference: string; formattedAddress: string; selectionProof: string;
};
const AUSTRALIAN_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']);

type InputProps = {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  inputMode?: 'text' | 'email' | 'tel'; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
};

function FieldInput({ label, value, onChangeText, placeholder = '', inputMode = 'text', autoCapitalize = 'sentences', multiline = false }: InputProps) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder}
    placeholderTextColor={colours.muted} inputMode={inputMode} autoCapitalize={autoCapitalize}
    multiline={multiline} style={[styles.input, multiline && styles.multiline]}
  /></View>;
}

function addressLine(match: CustomerMatch) {
  return [match.addressLine1, match.addressLine2, match.suburb, match.addressState, match.postcode].filter(Boolean).join(', ');
}

function jobCustomerName(job: JobMatch) {
  return `${job.jobRegister.firstName} ${job.jobRegister.lastName}`.trim() || job.title || 'Customer job';
}
function manualAddressProvenance(): AddressProvenance {
  return { entryMode: 'manual_pending_review', provider: '', providerReference: '', formattedAddress: '', selectionProof: '' };
}
function previousSetupStage(stage: Stage, selectedCustomer: CustomerMatch | null) {
  if (stage === 'work') return selectedCustomer ? 'find' : 'new-customer';
  if (stage === 'new-customer') return 'find';
  return null;
}

export default function NewCommercialScreen() {
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const { sync } = useApp();
  const navigation = useNavigation();
  const allowExit = useRef(false);
  const kindValue = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const kind: CommercialKind = kindValue === 'invoice' ? 'invoice' : 'quote';
  const [stage, setStage] = useState<Stage>('find');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerMatch | null>(null);
  const [options, setOptions] = useState<FieldJobOptions | null>(null);
  const [optionsAttempt, setOptionsAttempt] = useState(0);
  const [optionsError, setOptionsError] = useState('');
  const [serviceCategory, setServiceCategory] = useState('');
  const [description, setDescription] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [addressState, setAddressState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [addressPredictionSession, setAddressPredictionSession] = useState<{ token: string; query: string; predictions: AddressPrediction[] }>(() => ({ token: Crypto.randomUUID(), query: '', predictions: [] }));
  const [addressProvenance, setAddressProvenance] = useState<AddressProvenance>(manualAddressProvenance);
  const [addressLookupBusy, setAddressLookupBusy] = useState(false);
  const [addressLookupMessage, setAddressLookupMessage] = useState('Start typing an Australian street address, or enter it manually.');
  const suppressAddressLookup = useRef(false);
  const addressResolveController = useRef<AbortController | null>(null);
  const [clientRequestId, setClientRequestId] = useState(() => Crypto.randomUUID());
  const [workOrderId, setWorkOrderId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  usePreventRemove(stage !== 'editor', ({ data }) => {
    if (allowExit.current) { navigation.dispatch(data.action); return; }
    if (busy === 'create') return Alert.alert('Creating quote', 'Wait for the quote job to finish saving.');
    const previous = previousSetupStage(stage, selectedCustomer);
    if (previous) { setError(''); setStage(previous); return; }
    Alert.alert(`Cancel ${kind} setup?`, 'Your unsaved setup details will be cleared if you leave.', [
      { text: `Continue ${kind}`, style: 'cancel' },
      { text: 'Cancel setup', style: 'destructive', onPress: () => { allowExit.current = true; navigation.dispatch(data.action); } },
    ]);
  });

  useEffect(() => {
    if (kind !== 'quote') return;
    const controller = new AbortController();
    void apiRequest<FieldJobOptions>('/api/field/job-options', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setOptionsError(''); setOptions(result); } })
      .catch((caught) => { if (!controller.signal.aborted) setOptionsError(caught instanceof Error ? caught.message : 'Work types could not be loaded.'); });
    return () => controller.abort();
  }, [kind, optionsAttempt]);

  const serviceOptions = useMemo(() => options?.services.map((item) => ({ value: item.id, label: item.label })) || [], [options]);

  useEffect(() => () => addressResolveController.current?.abort(), []);

  useEffect(() => {
    if (suppressAddressLookup.current) {
      suppressAddressLookup.current = false;
      return;
    }
    const addressQuery = addressLine1.trim();
    if (stage !== 'new-customer' || addressQuery.length < 3) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setAddressLookupBusy(true);
      void apiRequest<{ configured?: boolean; predictions?: AddressPrediction[] }>('/api/trade-address-suggestions', {
        method: 'POST', body: JSON.stringify({ action: 'predict', query: addressQuery, sessionToken: addressPredictionSession.token }), signal: controller.signal,
      }).then((result) => {
        if (!active) return;
        const predictions = result.predictions || [];
        setAddressPredictionSession((current) => current.token === addressPredictionSession.token ? ({ ...current, query: addressQuery, predictions }) : current);
        setAddressLookupMessage(result.configured === false
          ? 'Address lookup is unavailable. Enter the address manually.'
          : predictions.length ? 'Choose the address below, or keep entering it manually.' : 'No matching address was found. Enter it manually.');
      }).catch(() => {
        if (!active || controller.signal.aborted) return;
        suppressAddressLookup.current = true;
        setAddressPredictionSession({ token: Crypto.randomUUID(), query: '', predictions: [] });
        setAddressLookupMessage('Address suggestions are temporarily unavailable. Enter the address manually.');
      }).finally(() => { if (active) setAddressLookupBusy(false); });
    }, 280);
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [addressLine1, addressPredictionSession.token, stage]);

  async function search() {
    const term = query.trim();
    if (term.length < 2) return setError('Enter at least two characters from the customer name, mobile, email or address.');
    if (!sync.online) return setError('Reconnect to search current TLink records.');
    setBusy('search'); setError(''); setSearched(false);
    try {
      if (kind === 'quote') {
        const result = await apiRequest<{ matches: CustomerMatch[] }>('/api/trade-crm', {
          method: 'POST', body: JSON.stringify({ action: 'find_quick_quote_customers', search: term }),
        });
        setMatches(result.matches.slice(0, 10)); setJobs([]);
      } else {
        const result = await apiRequest<JobSearchResult>(`/api/trade-crm?mode=index&resource=jobs&search=${encodeURIComponent(term)}&pageSize=25&total=0&commercial=invoice`);
        if (result.access?.permissions?.canManageInvoices !== true) throw new Error('Your Team access does not allow invoice changes.');
        setJobs(result.items.filter((item) => item.customerSource !== 'platform_private' && item.stage !== 'cancelled').slice(0, 10)); setMatches([]);
      }
      setSearched(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `The ${kind} search could not be completed.`);
    } finally { setBusy(''); }
  }

  function chooseCustomer(match: CustomerMatch) {
    if (!match.email) return setError('Add an email to this saved customer in TLink before creating a quote.');
    setSelectedCustomer(match); setClientRequestId(Crypto.randomUUID()); setServiceCategory(''); setDescription(''); setError(''); setStage('work');
  }

  function startNewCustomer() {
    setSelectedCustomer(null); setClientRequestId(Crypto.randomUUID()); setError(''); setStage('new-customer');
  }

  async function chooseAddress(prediction: AddressPrediction) {
    const addressQuery = addressPredictionSession.query;
    const sessionToken = addressPredictionSession.token;
    if (addressQuery.length < 3) return;
    addressResolveController.current?.abort();
    const controller = new AbortController();
    addressResolveController.current = controller;
    setAddressPredictionSession((current) => ({ ...current, predictions: [] }));
    setAddressLookupBusy(true); setAddressLookupMessage('Loading the selected address...');
    try {
      const result = await apiRequest<{ configured?: boolean; selection?: AddressSelection | null }>('/api/trade-address-suggestions', {
        method: 'POST', body: JSON.stringify({ action: 'resolve', provider: prediction.provider, providerReference: prediction.id, query: addressQuery, sessionToken }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const selection = result.selection;
      if (!selection) {
        suppressAddressLookup.current = true;
        setAddressPredictionSession({ token: Crypto.randomUUID(), query: '', predictions: [] });
        setAddressLookupMessage('This address could not be loaded. Enter it manually.');
        return;
      }
      suppressAddressLookup.current = true;
      setAddressLine1(selection.addressLine1); setAddressLine2(selection.addressLine2); setSuburb(selection.suburb);
      setAddressState(selection.addressState.toUpperCase()); setPostcode(selection.postcode.replace(/\D/g, '').slice(0, 4));
      setAddressProvenance({ entryMode: 'provider_selected', provider: selection.provider, providerReference: selection.providerReference, formattedAddress: selection.formattedAddress, selectionProof: selection.selectionProof });
      setAddressPredictionSession({ token: Crypto.randomUUID(), query: '', predictions: [] });
      setAddressLookupMessage('Address selected. Check the details, then continue.');
    } catch {
      if (!controller.signal.aborted) {
        suppressAddressLookup.current = true;
        setAddressPredictionSession({ token: Crypto.randomUUID(), query: '', predictions: [] });
        setAddressLookupMessage('This address could not be loaded. Enter it manually.');
      }
    } finally {
      if (addressResolveController.current === controller) { addressResolveController.current = null; setAddressLookupBusy(false); }
    }
  }

  function changeAddressLine1(value: string) {
    const abandonedResolution = Boolean(addressResolveController.current);
    addressResolveController.current?.abort(); addressResolveController.current = null;
    setAddressLine1(value); setAddressProvenance(manualAddressProvenance());
    setAddressPredictionSession((current) => ({ token: abandonedResolution || (value.trim().length < 3 && addressLine1.trim().length >= 3) ? Crypto.randomUUID() : current.token, query: '', predictions: [] }));
    setAddressLookupBusy(false); setAddressLookupMessage('Keep typing to find an address, or enter it manually.');
  }

  function changeAddressDetail(setter: (value: string) => void, value: string) {
    setter(value); setAddressProvenance(manualAddressProvenance());
  }

  function continueNewCustomer() {
    if (!firstName.trim() || !lastName.trim()) return setError('Add the customer first and last name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Add the customer email used to send the quote.');
    if (phone.replace(/\D/g, '').length < 8) return setError('Add a valid customer mobile number.');
    if (!addressLine1.trim() || !suburb.trim() || !AUSTRALIAN_STATES.has(addressState.trim().toUpperCase()) || !/^\d{4}$/.test(postcode.trim())) {
      return setError('Add the full property street, suburb, state and four-digit postcode.');
    }
    setError(''); setStage('work');
  }

  async function createQuoteJob() {
    if (!serviceCategory) return setError('Choose the work type for this quote.');
    if (!sync.online) return setError('Reconnect to create the quote job.');
    setBusy('create'); setError('');
    try {
      const body = selectedCustomer ? {
        action: 'create_quick_quote_job', clientRequestId, customerMode: 'existing', serviceSiteMode: 'existing',
        crmCustomerId: selectedCustomer.customerId, serviceSiteId: selectedCustomer.serviceSiteId,
        email: selectedCustomer.email, serviceCategory, description,
      } : {
        action: 'create_quick_quote_job', clientRequestId, customerMode: 'new', serviceSiteMode: 'new',
        firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), phone: phone.trim(),
        addressLine1: addressLine1.trim(), addressLine2: addressLine2.trim(), suburb: suburb.trim(),
        addressState: addressState.trim().toUpperCase(), postcode: postcode.trim(),
        addressEntryMode: addressProvenance.entryMode, addressProvider: addressProvenance.provider,
        addressProviderReference: addressProvenance.providerReference, addressFormatted: addressProvenance.formattedAddress,
        addressSelectionProof: addressProvenance.selectionProof,
        serviceCategory, description,
      };
      const result = await apiRequest<{ id: string }>('/api/trade-crm', { method: 'POST', body: JSON.stringify(body) });
      if (!result.id) throw new Error('The quote job was created without a usable record. Search for the customer before trying again.');
      setWorkOrderId(result.id); setStage('editor');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The quote job could not be created.');
    } finally { setBusy(''); }
  }

  if (stage === 'editor' && workOrderId) {
    return <Screen><FieldCommercialWorkspace
      workOrderId={workOrderId} selected={kind} online={sync.online} protectedJob={false}
      onSelect={(selected) => {
        if (selected !== null) return;
        if (kind === 'quote') { allowExit.current = true; router.back(); }
        else { setWorkOrderId(''); setStage('find'); }
      }}
    /></Screen>;
  }

  return <Screen>
    <View style={styles.hero}><MaterialCommunityIcons name={kind === 'quote' ? 'file-document-edit-outline' : 'receipt-text-plus-outline'} color={colours.green} size={34} /><View style={styles.flex}><Text style={styles.eyebrow}>QUICK CREATE</Text><Text style={styles.title}>New {kind}</Text><Text style={styles.help}>{kind === 'quote' ? 'Find the customer or add them, choose the work, then add price book or custom lines.' : 'Find the existing job by customer, mobile, email or address.'}</Text></View></View>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

    {stage === 'find' ? <View style={styles.card}>
      <FieldInput label={kind === 'quote' ? 'Find a saved customer' : 'Find an existing job'} value={query} onChangeText={setQuery} placeholder="Name, mobile, email or address" autoCapitalize="none" />
      <FieldButton loading={busy === 'search'} onPress={() => void search()}>Search</FieldButton>
      {kind === 'quote' ? <FieldButton variant="secondary" onPress={startNewCustomer}>New customer</FieldButton> : null}
      {searched && kind === 'quote' ? matches.map((match) => <Pressable key={`${match.customerId}:${match.serviceSiteId}`} accessibilityRole="button" onPress={() => chooseCustomer(match)} style={styles.result}>
        <View style={styles.flex}><Text style={styles.resultTitle}>{match.displayName}</Text><Text style={styles.resultText}>{[match.phone, match.email].filter(Boolean).join(' | ')}</Text><Text style={styles.resultText}>{addressLine(match) || 'Property to be confirmed'}</Text></View><MaterialCommunityIcons name="chevron-right" size={24} color={colours.green} />
      </Pressable>) : null}
      {searched && kind === 'invoice' ? jobs.map((job) => <Pressable key={job.id} accessibilityRole="button" onPress={() => { setWorkOrderId(job.id); setStage('editor'); }} style={styles.result}>
        <View style={styles.flex}><Text style={styles.resultTitle}>{jobCustomerName(job)}</Text><Text style={styles.resultText}>{job.jobRegister.jobId} | {job.jobRegister.service}</Text><Text style={styles.resultText}>{[job.jobRegister.contactNumber, job.jobRegister.email, job.jobRegister.streetAddress].filter(Boolean).join(' | ')}</Text></View><MaterialCommunityIcons name="chevron-right" size={24} color={colours.green} />
      </Pressable>) : null}
      {searched && !matches.length && !jobs.length ? <Text style={styles.help}>{kind === 'quote' ? 'No saved customer matched. Add a new customer to continue.' : 'No direct customer job matched that search.'}</Text> : null}
    </View> : null}

    {stage === 'new-customer' ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Customer</Text>
      <FieldInput label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
      <FieldInput label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
      <FieldInput label="Email for the quote" value={email} onChangeText={setEmail} inputMode="email" autoCapitalize="none" />
      <FieldInput label="Mobile" value={phone} onChangeText={setPhone} inputMode="tel" />
      <Text style={styles.cardTitle}>Property</Text>
      <FieldInput label="Search street address" value={addressLine1} onChangeText={changeAddressLine1} autoCapitalize="words" placeholder="Start typing the street address" />
      {addressPredictionSession.predictions.length ? <View style={styles.addressSuggestions}>{addressPredictionSession.predictions.map((prediction) => <Pressable accessibilityRole="button" accessibilityLabel={`Use address ${prediction.label}`} key={`${prediction.provider}:${prediction.id}`} onPress={() => void chooseAddress(prediction)} style={styles.addressSuggestion}><MaterialCommunityIcons name="map-marker-outline" color={colours.green} size={22} /><Text style={styles.addressSuggestionText}>{prediction.label}</Text></Pressable>)}{addressPredictionSession.predictions.some((prediction) => prediction.provider === 'google-places' || prediction.provider === 'google-geocoding') ? <Text style={styles.addressAttribution}>Google Maps</Text> : null}</View> : null}
      <Text accessibilityLiveRegion="polite" style={styles.addressHelp}>{addressLookupBusy ? 'Searching addresses...' : addressLookupMessage}</Text>
      <FieldInput label="Unit or level, optional" value={addressLine2} onChangeText={(value) => changeAddressDetail(setAddressLine2, value)} autoCapitalize="words" />
      <FieldInput label="Suburb" value={suburb} onChangeText={(value) => changeAddressDetail(setSuburb, value)} autoCapitalize="words" />
      <View style={styles.row}><View style={styles.flex}><FieldInput label="State" value={addressState} onChangeText={(value) => changeAddressDetail(setAddressState, value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3))} autoCapitalize="characters" /></View><View style={styles.flex}><FieldInput label="Postcode" value={postcode} onChangeText={(value) => changeAddressDetail(setPostcode, value.replace(/\D/g, '').slice(0, 4))} inputMode="tel" /></View></View>
      <FieldButton onPress={continueNewCustomer}>Continue to work</FieldButton>
      <FieldButton variant="secondary" onPress={() => { setError(''); setStage('find'); }}>Back</FieldButton>
    </View> : null}

    {stage === 'work' ? <View style={styles.card}>
      <Text style={styles.cardTitle}>Work</Text>
      <View style={styles.summary}><Text style={styles.resultTitle}>{selectedCustomer?.displayName || `${firstName} ${lastName}`.trim()}</Text><Text style={styles.resultText}>{selectedCustomer?.phone || phone}</Text><Text style={styles.resultText}>{selectedCustomer ? addressLine(selectedCustomer) || 'Property to be confirmed' : [addressLine1, addressLine2, suburb, addressState, postcode].filter(Boolean).join(', ')}</Text></View>
      {optionsError ? <><Text accessibilityLiveRegion="polite" style={styles.error}>{optionsError}</Text><FieldButton variant="secondary" onPress={() => setOptionsAttempt((value) => value + 1)}>Retry work types</FieldButton></> : null}
      <FieldSelect label="Work type" value={serviceCategory} options={serviceOptions} onChange={setServiceCategory} disabled={!options} placeholder={options ? 'Choose work type' : 'Loading work types'} />
      <FieldInput label="Short work description, optional" value={description} onChangeText={setDescription} placeholder="What the customer wants quoted" multiline />
      <FieldButton loading={busy === 'create'} disabled={!options} onPress={() => void createQuoteJob()}>Create job and add quote lines</FieldButton>
      <FieldButton variant="secondary" onPress={() => { const previous = previousSetupStage(stage, selectedCustomer); if (previous) { setError(''); setStage(previous); } }}>Back</FieldButton>
      <Text style={styles.note}>This creates an unscheduled CRM job only. You can assign and book it later.</Text>
    </View> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1 },
  eyebrow: { color: colours.green, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colours.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', marginTop: 3 },
  help: { color: colours.muted, lineHeight: 21, marginTop: spacing.xs },
  card: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.line, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  cardTitle: { color: colours.ink, fontSize: 21, fontWeight: '800' },
  field: { gap: spacing.xs },
  label: { color: colours.ink, fontWeight: '700', fontSize: 15 },
  input: { minHeight: 50, padding: spacing.md, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, backgroundColor: colours.surfaceRaised, color: colours.ink, fontSize: 16 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  result: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, backgroundColor: colours.surfaceRaised },
  resultTitle: { color: colours.ink, fontSize: 17, fontWeight: '800' },
  resultText: { color: colours.muted, lineHeight: 20, marginTop: 2 },
  summary: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.mint },
  row: { flexDirection: 'row', gap: spacing.sm },
  addressSuggestions: { borderWidth: 1, borderColor: colours.line, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colours.surfaceRaised },
  addressSuggestion: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colours.line },
  addressSuggestionText: { color: colours.ink, flex: 1, lineHeight: 20 },
  addressAttribution: { color: colours.muted, fontSize: 12, fontWeight: '700', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, textAlign: 'right' },
  addressHelp: { color: colours.muted, fontSize: 13, lineHeight: 18, marginTop: -spacing.sm },
  error: { color: colours.red, lineHeight: 21, padding: spacing.md, borderRadius: radius.md, backgroundColor: colours.redSoft },
  note: { color: colours.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
