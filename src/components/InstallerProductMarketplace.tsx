"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type MarketplaceProduct = {
  id: string;
  modelNumber: string;
  brand: string;
  name: string;
  category: string;
  description: string;
  unitPriceCentsExGst: number;
  minOrderQty: number;
  orderIncrement: number;
  unitLabel: string;
  stockStatus: string;
  leadTimeDays: number;
  warrantyYears: number;
  datasheetUrl: string;
  supplierUid: string;
  supplierName: string;
  supplierWebsite: string;
  serviceStates: string[];
  dependencies: {
    relationship: string;
    defaultQty: number;
    note: string;
    productId: string;
    modelNumber: string;
    brand: string;
    name: string;
    unitPriceCentsExGst: number;
  }[];
};

type SelectionItem = {
  id: string;
  productId: string;
  supplierUid: string;
  quantity: number;
  unitPriceCentsExGst: number;
  modelNumber: string;
  brand: string;
  name: string;
  unitLabel: string;
  minOrderQty: number;
  orderIncrement: number;
  supplierName: string;
  supplierWebsite: string;
};

type ProductList = {
  id: string;
  name: string;
  projectPostcode: string;
  notes: string;
  status: "draft" | "submitted" | "archived";
  submittedAt: string;
  updatedAt: string;
  items: SelectionItem[];
  enquiries: Array<{
    id: string;
    supplierUid: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});
const categoryLabels: Record<string, string> = {
  assessment: "Assessment equipment",
  solar: "Solar",
  battery: "Battery",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control",
  "ev-charging": "EV charging",
  electrical: "Electrical",
  plumbing: "Plumbing",
  "mounting-hardware": "Mounting and hardware",
  controls: "Controls and monitoring",
  other: "Other",
};

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function InstallerProductMarketplace({ user }: { user: User }) {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [lists, setLists] = useState<ProductList[]>([]);
  const [activeListId, setActiveListId] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState("");
  const [brand, setBrand] = useState("");
  const [serviceState, setServiceState] = useState("");
  const [stock, setStock] = useState("");
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [maximumLeadTime, setMaximumLeadTime] = useState("");
  const [minimumWarranty, setMinimumWarranty] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [status, setStatus] = useState("Loading approved wholesaler products...");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [listName, setListName] = useState("");
  const [projectPostcode, setProjectPostcode] = useState("");
  const [listNotes, setListNotes] = useState("");
  const [enquiryMessage, setEnquiryMessage] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await user.getIdToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || "The product workspace could not be updated.");
    return result;
  }, [user]);

  const applyLists = useCallback((nextLists: ProductList[]) => {
    setLists(nextLists);
    setActiveListId((current) =>
      nextLists.some((list) => list.id === current)
        ? current
        : nextLists.find((list) => list.status === "draft")?.id || nextLists[0]?.id || "",
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const [productResult, selectionResult] = await Promise.all([
        request("/api/product-marketplace"),
        request("/api/product-selections"),
      ]);
      setProducts(productResult.products || []);
      applyLists(selectionResult.lists || []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The trade catalogue could not be loaded.");
    }
  }, [applyLists, request]);

  useEffect(() => {
    // The authenticated APIs own the catalogue and saved selection state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filterOptions = useMemo(() => ({
    suppliers: [...new Set(products.map((item) => item.supplierName))].sort((a, b) => a.localeCompare(b)),
    brands: [...new Set(products.filter((item) => !supplier || item.supplierName === supplier).map((item) => item.brand))].sort((a, b) => a.localeCompare(b)),
    states: [...new Set(products.flatMap((item) => item.serviceStates))].sort((a, b) => a.localeCompare(b)),
    stocks: [...new Set(products.map((item) => item.stockStatus))].sort((a, b) => a.localeCompare(b)),
  }), [products, supplier]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const minCents = minimumPrice === "" ? 0 : Number(minimumPrice) * 100;
    const maxCents = maximumPrice === "" ? Number.POSITIVE_INFINITY : Number(maximumPrice) * 100;
    const maxDays = maximumLeadTime === "" ? Number.POSITIVE_INFINITY : Number(maximumLeadTime);
    const minWarranty = minimumWarranty === "" ? 0 : Number(minimumWarranty);
    return products.filter((item) =>
      (!category || item.category === category) &&
      (!supplier || item.supplierName === supplier) &&
      (!brand || item.brand === brand) &&
      (!serviceState || item.serviceStates.includes(serviceState)) &&
      (!stock || item.stockStatus === stock) &&
      item.unitPriceCentsExGst >= minCents && item.unitPriceCentsExGst <= maxCents &&
      item.leadTimeDays <= maxDays && item.warrantyYears >= minWarranty &&
      (!term || `${item.modelNumber} ${item.brand} ${item.name} ${item.description} ${item.supplierName} ${item.category}`.toLowerCase().includes(term)),
    ).sort((left, right) => {
      if (sort === "name-desc") return right.name.localeCompare(left.name);
      if (sort === "brand-asc") return left.brand.localeCompare(right.brand) || left.name.localeCompare(right.name);
      if (sort === "supplier-asc") return left.supplierName.localeCompare(right.supplierName) || left.name.localeCompare(right.name);
      if (sort === "price-asc") return left.unitPriceCentsExGst - right.unitPriceCentsExGst;
      if (sort === "price-desc") return right.unitPriceCentsExGst - left.unitPriceCentsExGst;
      if (sort === "lead-asc") return left.leadTimeDays - right.leadTimeDays || left.name.localeCompare(right.name);
      if (sort === "model-asc") return left.modelNumber.localeCompare(right.modelNumber);
      return left.name.localeCompare(right.name) || left.brand.localeCompare(right.brand);
    });
  }, [products, search, category, supplier, brand, serviceState, stock, minimumPrice, maximumPrice, maximumLeadTime, minimumWarranty, sort]);
  const activeFilterCount = [category, supplier, brand, serviceState, stock, minimumPrice, maximumPrice, maximumLeadTime, minimumWarranty].filter(Boolean).length;
  function clearFilters() {
    setSearch(""); setCategory(""); setSupplier(""); setBrand(""); setServiceState(""); setStock("");
    setMinimumPrice(""); setMaximumPrice(""); setMaximumLeadTime(""); setMinimumWarranty(""); setSort("name-asc");
  }
  const activeList = lists.find((list) => list.id === activeListId) || null;
  const listSubtotal = activeList?.items.reduce(
    (total, item) => total + item.quantity * item.unitPriceCentsExGst,
    0,
  ) || 0;
  const supplierCount = new Set(activeList?.items.map((item) => item.supplierUid) || []).size;

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Creating the project product list...");
    try {
      const result = await request("/api/product-selections", {
        method: "POST",
        body: JSON.stringify({ action: "create", name: listName, projectPostcode, notes: listNotes }),
      });
      applyLists(result.lists || []);
      setListName("");
      setProjectPostcode("");
      setListNotes("");
      setCreating(false);
      setStatus("Project product list created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The product list could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function addProduct(product: MarketplaceProduct) {
    if (!activeList || activeList.status !== "draft") {
      setCreating(true);
      setStatus("Create or choose a draft list before adding products.");
      return;
    }
    setBusy(true);
    setStatus(`Adding ${product.name} to ${activeList.name}...`);
    try {
      const result = await request("/api/product-selections", {
        method: "POST",
        body: JSON.stringify({ action: "add_item", listId: activeList.id, productId: product.id, quantity: product.minOrderQty }),
      });
      applyLists(result.lists || []);
      setStatus(`${product.name} added to the project list.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The product could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function updateItem(action: "quantity" | "remove_item", item: SelectionItem, quantity = item.quantity) {
    if (!activeList) return;
    setBusy(true);
    try {
      const result = await request("/api/product-selections", {
        method: "PATCH",
        body: JSON.stringify({ action, listId: activeList.id, itemId: item.id, quantity }),
      });
      applyLists(result.lists || []);
      setStatus(action === "remove_item" ? "Product removed from the list." : "Quantity updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The product list could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEnquiry() {
    if (!activeList) return;
    setBusy(true);
    setStatus("Sending a separate product enquiry to each selected wholesaler...");
    try {
      const result = await request("/api/product-selections", {
        method: "POST",
        body: JSON.stringify({ action: "submit", listId: activeList.id, message: enquiryMessage }),
      });
      applyLists(result.lists || []);
      setEnquiryMessage("");
      setStatus("Product enquiries sent. Each wholesaler sees only its own selected items.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The product enquiries could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dashboard-panel installer-marketplace" aria-labelledby="installer-marketplace-title">
      <div className="dashboard-panel-heading">
        <span>Approved wholesale catalogue</span>
        <h2 id="installer-marketplace-title">Build project lists and request trade supply</h2>
        <p>
          Compare approved products, save model-level selections and send each wholesaler a structured enquiry.
          Prices are wholesaler-supplied before GST and remain indicative until the wholesaler confirms stock, freight and trade terms.
        </p>
      </div>
      <div className="marketplace-workspace-layout">
        <div className="marketplace-catalogue-column">
          <div className="marketplace-finder" aria-label="Advanced product finder">
            <div className="marketplace-filterbar">
              <label className="marketplace-search"><span>Search products</span><input type="search" placeholder="Product, model code, brand or wholesaler" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select></label>
              <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="name-asc">Product name A to Z</option><option value="name-desc">Product name Z to A</option>
                <option value="brand-asc">Brand A to Z</option><option value="supplier-asc">Wholesaler A to Z</option>
                <option value="price-asc">Price low to high</option><option value="price-desc">Price high to low</option>
                <option value="lead-asc">Fastest availability</option><option value="model-asc">Model code A to Z</option>
              </select></label>
            </div>
            <details className="marketplace-advanced-filters">
              <summary>Advanced filters{activeFilterCount ? ` (${activeFilterCount} active)` : ""}</summary>
              <div>
                <label><span>Wholesaler</span><select value={supplier} onChange={(event) => { setSupplier(event.target.value); setBrand(""); }}><option value="">All wholesalers</option>{filterOptions.suppliers.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Brand</span><select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="">All brands</option>{filterOptions.brands.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Available in state</span><select value={serviceState} onChange={(event) => setServiceState(event.target.value)}><option value="">All service states</option>{filterOptions.states.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label><span>Stock availability</span><select value={stock} onChange={(event) => setStock(event.target.value)}><option value="">Any stock status</option>{filterOptions.stocks.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
                <label><span>Minimum price, ex GST</span><input type="number" min="0" step="1" inputMode="decimal" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} placeholder="$0" /></label>
                <label><span>Maximum price, ex GST</span><input type="number" min="0" step="1" inputMode="decimal" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} placeholder="No maximum" /></label>
                <label><span>Maximum lead time</span><select value={maximumLeadTime} onChange={(event) => setMaximumLeadTime(event.target.value)}><option value="">Any lead time</option><option value="0">Available now</option><option value="3">3 days or less</option><option value="7">7 days or less</option><option value="14">14 days or less</option><option value="30">30 days or less</option></select></label>
                <label><span>Minimum warranty</span><select value={minimumWarranty} onChange={(event) => setMinimumWarranty(event.target.value)}><option value="">Any warranty</option><option value="5">5 years or more</option><option value="10">10 years or more</option><option value="20">20 years or more</option></select></label>
              </div>
            </details>
            <div className="marketplace-result-summary"><span><strong>{filtered.length}</strong> of {products.length} approved products</span>{(activeFilterCount > 0 || search) && <button type="button" onClick={clearFilters}>Clear all filters</button>}</div>
          </div>
          {status && <p className="dashboard-settings-status" role="status">{status}</p>}
          {filtered.length ? (
            <div className="marketplace-product-grid">
              {filtered.map((product) => {
                const selected = activeList?.items.some((item) => item.productId === product.id);
                return (
                  <article key={product.id}>
                    <header>
                      <span>{product.supplierName}</span>
                      <strong>{product.brand} · {product.modelNumber}</strong>
                      <h3>{product.name}</h3>
                    </header>
                    <p>{product.description}</p>
                    <div className="marketplace-price">
                      <strong>{money.format(product.unitPriceCentsExGst / 100)}</strong>
                      <span>ex GST · {money.format((product.unitPriceCentsExGst * 1.1) / 100)} inc GST</span>
                    </div>
                    <ul>
                      <li>Minimum {product.minOrderQty} {product.unitLabel}; order in {product.orderIncrement}s</li>
                      <li>{readable(product.stockStatus)}{product.leadTimeDays ? ` · ${product.leadTimeDays} day lead time` : ""}</li>
                      <li>{product.warrantyYears ? `${product.warrantyYears} year stated product warranty` : "Warranty term not stated"}</li>
                      <li>{product.serviceStates.length ? `Available in ${product.serviceStates.join(", ")}` : "Confirm service state with wholesaler"}</li>
                    </ul>
                    {product.dependencies.length > 0 && (
                      <details>
                        <summary>{product.dependencies.length} linked kit item{product.dependencies.length === 1 ? "" : "s"}</summary>
                        {product.dependencies.map((item) => (
                          <div key={`${item.productId}-${item.relationship}`}>
                            <strong>{item.relationship}: {item.brand} {item.modelNumber}</strong>
                            <span>{item.defaultQty} × {item.name} · {money.format(item.unitPriceCentsExGst / 100)} ex GST each</span>
                            {item.note && <small>{item.note}</small>}
                          </div>
                        ))}
                      </details>
                    )}
                    <div className="marketplace-product-actions">
                      <button type="button" disabled={busy || selected || activeList?.status !== "draft"} onClick={() => void addProduct(product)}>
                        {selected ? "Added to list" : "Add to project list"}
                      </button>
                      {product.datasheetUrl && <a href={product.datasheetUrl} target="_blank" rel="noreferrer">Product details</a>}
                      {product.supplierWebsite && <a href={product.supplierWebsite} target="_blank" rel="noreferrer">Wholesaler website</a>}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : !status && (
            <div className="dashboard-empty-state"><strong>No approved products match this view</strong><p>Change the search or check again after paying wholesalers publish reviewed catalogue items.</p></div>
          )}
        </div>

        <aside className="marketplace-selection-builder" aria-label="Project product list">
          <div className="marketplace-list-toolbar">
            <div><span>Product selection</span><h3>Project list</h3></div>
            <button type="button" onClick={() => setCreating((value) => !value)}>New list</button>
          </div>
          {lists.length > 0 && (
            <label className="marketplace-list-select">
              Saved lists
              <select value={activeListId} onChange={(event) => setActiveListId(event.target.value)}>
                {lists.map((list) => <option key={list.id} value={list.id}>{list.name} · {readable(list.status)}</option>)}
              </select>
            </label>
          )}
          {(creating || !lists.length) && (
            <form className="marketplace-list-form" onSubmit={createList}>
              <label>List name<input required value={listName} onChange={(event) => setListName(event.target.value)} placeholder="e.g. Carlton battery proposal" /></label>
              <label>Project postcode<input inputMode="numeric" maxLength={4} value={projectPostcode} onChange={(event) => setProjectPostcode(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Optional" /></label>
              <label>Scope note<textarea value={listNotes} onChange={(event) => setListNotes(event.target.value)} placeholder="Commercial scope only. Do not include customer names, addresses or contact details." /></label>
              <button disabled={busy}>Create product list</button>
            </form>
          )}
          {activeList ? (
            <>
              <div className="marketplace-list-heading">
                <span className={`admin-pill admin-pill-${activeList.status}`}>{readable(activeList.status)}</span>
                <h3>{activeList.name}</h3>
                <small>{activeList.projectPostcode ? `Project postcode ${activeList.projectPostcode}` : "No project postcode added"}</small>
              </div>
              <div className="marketplace-selected-items">
                {activeList.items.length ? activeList.items.map((item) => (
                  <article key={item.id}>
                    <div><span>{item.supplierName}</span><strong>{item.brand} {item.modelNumber}</strong><small>{item.name}</small></div>
                    <div className="marketplace-item-quantity">
                      <label>Qty<input type="number" min={item.minOrderQty} step={item.orderIncrement} defaultValue={item.quantity} disabled={busy || activeList.status !== "draft"} onBlur={(event) => void updateItem("quantity", item, Number(event.target.value))} /></label>
                      <strong>{money.format((item.quantity * item.unitPriceCentsExGst) / 100)}</strong>
                      {activeList.status === "draft" && <button type="button" onClick={() => void updateItem("remove_item", item)}>Remove</button>}
                    </div>
                  </article>
                )) : <p>Add approved products from the catalogue to build this project list.</p>}
              </div>
              <div className="marketplace-list-total">
                <div><span>Indicative subtotal</span><strong>{money.format(listSubtotal / 100)} ex GST</strong></div>
                <small>{activeList.items.length} item{activeList.items.length === 1 ? "" : "s"} across {supplierCount} wholesaler{supplierCount === 1 ? "" : "s"}</small>
              </div>
              {activeList.status === "draft" ? (
                <div className="marketplace-enquiry-submit">
                  <label>Message to wholesalers<textarea maxLength={600} value={enquiryMessage} onChange={(event) => setEnquiryMessage(event.target.value)} placeholder="Ask about trade terms, freight, availability or technical support." /></label>
                  <small>Each wholesaler receives only its own products. Do not include household names, street addresses or customer contact details.</small>
                  <button type="button" disabled={busy || !activeList.items.length} onClick={() => void submitEnquiry()}>Send product enquiries</button>
                </div>
              ) : (
                <div className="marketplace-enquiry-status">
                  <strong>Enquiries sent</strong>
                  {activeList.enquiries.map((enquiry) => <span key={enquiry.id}>{readable(enquiry.status)} · updated {new Date(enquiry.updatedAt).toLocaleDateString("en-AU")}</span>)}
                </div>
              )}
            </>
          ) : !creating && <div className="dashboard-empty-state"><strong>No project lists yet</strong><p>Create a list to start selecting products.</p></div>}
        </aside>
      </div>
    </section>
  );
}
