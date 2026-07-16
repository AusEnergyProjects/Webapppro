"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceListControls, type WorkspaceListPreferences } from "@/components/WorkspaceListControls";
import { downloadWorkspaceCsv } from "@/components/WorkspaceTableTools";
import { readable, resetWorkspaceListView, saveWorkspaceListView, workspaceError as errorMessage } from "@/components/admin-workspace";
import styles from "./AdminCatalogueWorkspace.module.css";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type ListPagination = { page: number; pageSize: number; total: number; pageCount: number; hasNext?: boolean; nextCursor?: string };
type CatalogueProduct = {
  id: string;
  supplierName: string;
  supplierEmail: string;
  modelNumber: string;
  brand: string;
  name: string;
  category: string;
  unitPriceCentsExGst: number;
  minOrderQty: number;
  stockStatus: string;
  leadTimeDays: number;
  warrantyYears: number;
  listingStatus: string;
  reviewStatus: string;
  reviewNote: string;
  linkedCount: number;
  isSynthetic: boolean;
};
type AdminApiResult = {
  counts?: { total?: number; pending?: number; approved?: number; live?: number };
  pagination?: Partial<ListPagination>;
  preferences?: WorkspaceListPreferences;
  products?: CatalogueProduct[];
  saved?: boolean;
};

const emptyPagination: ListPagination = { page: 1, pageSize: 25, total: 0, pageCount: 1 };
const categories = ["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "electrical", "plumbing", "mounting-hardware", "controls", "other"];

export type AdminCatalogueWorkspaceProps = {
  api: (path: string, init?: RequestInit) => Promise<AdminApiResult>;
  role: AdminRole;
  setStatus: (status: string) => void;
};

export function AdminCatalogueWorkspace({ api, role, setStatus }: AdminCatalogueWorkspaceProps) {
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productWholesaler, setProductWholesaler] = useState("");
  const [productBrand, setProductBrand] = useState("");
  const [productModel, setProductModel] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [productStock, setProductStock] = useState("");
  const [productReviewStatus, setProductReviewStatus] = useState("");
  const [productListingStatus, setProductListingStatus] = useState("");
  const [productMinimumPrice, setProductMinimumPrice] = useState("");
  const [productMaximumPrice, setProductMaximumPrice] = useState("");
  const [productSynthetic, setProductSynthetic] = useState("");
  const [productSort, setProductSort] = useState("priority-desc");
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(25);
  const [productPagination, setProductPagination] = useState<ListPagination>(emptyPagination);
  const productCursors = useRef<string[]>([""]);
  const productTotalReady = useRef(false);
  const [productListCounts, setProductListCounts] = useState({ total: 0, pending: 0, approved: 0, live: 0 });
  const [productViewReady, setProductViewReady] = useState(false);
  const [productViewSaved, setProductViewSaved] = useState(false);
  const [productViewBusy, setProductViewBusy] = useState(false);
  const [productReview, setProductReview] = useState<Record<string, { reviewStatus: string; reviewNote: string; listingStatus: string }>>({});

  const loadProducts = useCallback(async (announce = false) => {
    const params = new URLSearchParams({ page: String(productPage), pageSize: String(productPageSize), sort: productSort });
    const cursor = productCursors.current[productPage - 1] || "";
    if (cursor) params.set("cursor", cursor);
    if (productTotalReady.current) params.set("total", "0");
    if (productSearch.trim()) params.set("search", productSearch.trim());
    if (productWholesaler.trim()) params.set("supplier", productWholesaler.trim());
    if (productBrand.trim()) params.set("brand", productBrand.trim());
    if (productModel.trim()) params.set("model", productModel.trim());
    if (productCategory) params.set("category", productCategory);
    if (productStock) params.set("stock", productStock);
    if (productReviewStatus) params.set("review", productReviewStatus);
    if (productListingStatus) params.set("listing", productListingStatus);
    if (productMinimumPrice) params.set("minPrice", productMinimumPrice);
    if (productMaximumPrice) params.set("maxPrice", productMaximumPrice);
    if (productSynthetic) params.set("synthetic", productSynthetic);
    try {
      const result = await api(`/api/admin/products?${params}`);
      const nextProducts = result.products || [];
      setProducts(nextProducts);
      setProductPagination((current) => {
        const next = { ...current, ...(result.pagination || {}), page: productPage, pageSize: productPageSize };
        if (typeof result.pagination?.total === "number") productTotalReady.current = true;
        if (next.hasNext && next.nextCursor) productCursors.current[productPage] = next.nextCursor;
        productCursors.current.length = Math.max(productPage, next.hasNext ? productPage + 1 : productPage);
        return next;
      });
      setProductListCounts({ total: result.counts?.total || 0, pending: result.counts?.pending || 0, approved: result.counts?.approved || 0, live: result.counts?.live || 0 });
      setProductReview(Object.fromEntries(nextProducts.map((product) => [product.id, {
        reviewStatus: product.reviewStatus, reviewNote: product.reviewNote || "", listingStatus: product.listingStatus,
      }])));
      if (announce) setStatus(`${result.pagination?.total || 0} catalogue products match this view.`);
    } catch (error) { setStatus(errorMessage(error)); }
  }, [api, productBrand, productCategory, productListingStatus, productMaximumPrice, productMinimumPrice, productModel, productPage, productPageSize, productReviewStatus, productSearch, productSort, productStock, productSynthetic, productWholesaler, setStatus]);

  useEffect(() => {
    let cancelled = false;
    void api("/api/admin/list-views?view=admin-products").then((result) => {
      if (cancelled) return;
      const preferences = result.preferences as WorkspaceListPreferences;
      setProductSearch(preferences.search || "");
      setProductWholesaler(preferences.supplier || "");
      setProductBrand(preferences.brand || "");
      setProductModel(preferences.model || "");
      setProductCategory(preferences.category || "");
      setProductStock(preferences.stock || "");
      setProductReviewStatus(preferences.filter === "all" ? "" : preferences.filter || "");
      setProductListingStatus(preferences.listing || "");
      setProductMinimumPrice(preferences.minPrice || "");
      setProductMaximumPrice(preferences.maxPrice || "");
      setProductSynthetic(preferences.synthetic || "");
      setProductSort(preferences.sort || "priority-desc");
      setProductPageSize(preferences.pageSize || 25);
      setProductViewSaved(Boolean(result.saved));
    }).catch((error) => setStatus(errorMessage(error))).finally(() => {
      if (!cancelled) setProductViewReady(true);
    });
    return () => { cancelled = true; };
  }, [api, setStatus]);

  useEffect(() => {
    productCursors.current = [""]; productTotalReady.current = false;
  }, [productBrand, productCategory, productListingStatus, productMaximumPrice, productMinimumPrice, productModel, productPageSize, productReviewStatus, productSearch, productSort, productStock, productSynthetic, productWholesaler]);

  useEffect(() => {
    if (!productViewReady) return;
    const timer = window.setTimeout(() => { void loadProducts(); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadProducts, productViewReady]);

  function applyProductView(preferences: WorkspaceListPreferences) {
    setProductSearch(preferences.search || ""); setProductWholesaler(preferences.supplier || "");
    setProductBrand(preferences.brand || ""); setProductModel(preferences.model || "");
    setProductCategory(preferences.category || ""); setProductStock(preferences.stock || "");
    setProductReviewStatus(preferences.filter === "all" ? "" : preferences.filter || ""); setProductListingStatus(preferences.listing || "");
    setProductMinimumPrice(preferences.minPrice || ""); setProductMaximumPrice(preferences.maxPrice || "");
    setProductSynthetic(preferences.synthetic || ""); setProductSort(preferences.sort || "priority-desc");
    setProductPageSize(preferences.pageSize || 25); setProductPage(1);
  }

  async function saveProductView() {
    setProductViewBusy(true);
    try {
      await saveWorkspaceListView(api, "admin-products", { search: productSearch, filter: productReviewStatus || "all", sort: productSort, pageSize: productPageSize, supplier: productWholesaler, brand: productBrand, model: productModel, category: productCategory, stock: productStock, listing: productListingStatus, minPrice: productMinimumPrice, maxPrice: productMaximumPrice, synthetic: productSynthetic });
      setProductViewSaved(true);
      setStatus("Your default table view has been saved.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setProductViewBusy(false); }
  }

  async function resetProductView() {
    setProductViewBusy(true);
    try {
      applyProductView(await resetWorkspaceListView(api, "admin-products"));
      setProductViewSaved(false);
      setStatus("The table view has been reset to the TLink default.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setProductViewBusy(false); }
  }

  async function reviewProduct(product: CatalogueProduct) {
    const decision = productReview[product.id] || { reviewStatus: product.reviewStatus, reviewNote: product.reviewNote, listingStatus: product.listingStatus };
    setStatus(`Saving catalogue review for ${product.modelNumber}...`);
    try {
      await api("/api/admin/products", { method: "PATCH", body: JSON.stringify({ id: product.id, ...decision }) });
      await loadProducts();
      setStatus("Catalogue decision saved and added to the audit history.");
    } catch (error) { setStatus(errorMessage(error)); }
  }

  function exportProducts() {
    downloadWorkspaceCsv("tlink-admin-products.csv", [
      { key: "wholesaler", label: "Wholesaler" }, { key: "brand", label: "Brand" }, { key: "model", label: "Model code" },
      { key: "product", label: "Product" }, { key: "category", label: "Category" }, { key: "price", label: "Price ex GST" },
      { key: "minimum", label: "Minimum order" }, { key: "stock", label: "Stock" }, { key: "lead", label: "Lead time days" },
      { key: "warranty", label: "Warranty years" }, { key: "review", label: "Review" }, { key: "listing", label: "Listing" }, { key: "linked", label: "Linked kit" },
    ], products.map((item) => ({ wholesaler: item.supplierName, brand: item.brand, model: item.modelNumber, product: item.name, category: readable(item.category), price: (item.unitPriceCentsExGst / 100).toFixed(2), minimum: item.minOrderQty, stock: readable(item.stockStatus), lead: item.leadTimeDays, warranty: item.warrantyYears, review: readable(item.reviewStatus), listing: readable(item.listingStatus), linked: item.linkedCount })));
  }

  return <div className={styles.workspace}>
    <header className="admin-page-heading">
      <span>Wholesaler supply network</span><h1>Product catalogue and availability</h1>
      <p>Moderate model-level products, ex-GST prices, ordering rules and linked kit items. This workspace has no household lead data and wholesalers never enter the opportunity workflow.</p>
    </header>
    <div className="admin-context-filter"><label>Catalogue data<select aria-label="Catalogue data marker" value={productSynthetic} onChange={(event) => { setProductSynthetic(event.target.value); setProductPage(1); }}><option value="">Live and demo products</option><option value="exclude">Live products only</option><option value="only">Demo products only</option></select></label><span>{productPagination.total} products match</span></div>
    <section className="admin-metric-grid"><article><span>Total products</span><strong>{productListCounts.total}</strong><small>Across verified and pending wholesalers</small></article><article><span>Awaiting review</span><strong>{productListCounts.pending}</strong><small>New or materially changed listings</small></article><article><span>Approved</span><strong>{productListCounts.approved}</strong><small>Catalogue evidence accepted</small></article><article><span>Live to installers</span><strong>{productListCounts.live}</strong><small>Approved and published listings only</small></article></section>
    <div className="workspace-table-actionbar"><button className="workspace-csv-export" type="button" disabled={!products.length} onClick={exportProducts}>Export visible products CSV</button></div>
    <section className="admin-panel admin-catalogue-workspace"><div className="admin-panel-heading"><span>Catalogue controls</span><h2>Review products without exposing customer information</h2><p>Confirm the model identity, description, ex-GST price, minimum order, availability, warranty and dependency count.</p></div>
      <div className="admin-catalogue-granular crm-granular-filters"><div>
        <label><span>Product name</span><input type="search" placeholder="Product name" value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setProductPage(1); }} /></label>
        <label><span>Wholesaler</span><input placeholder="Wholesaler" value={productWholesaler} onChange={(event) => { setProductWholesaler(event.target.value); setProductPage(1); }} /></label>
        <label><span>Brand</span><input placeholder="Brand" value={productBrand} onChange={(event) => { setProductBrand(event.target.value); setProductPage(1); }} /></label>
        <label><span>Model code</span><input placeholder="Model code" value={productModel} onChange={(event) => { setProductModel(event.target.value); setProductPage(1); }} /></label>
        <label><span>Category</span><select value={productCategory} onChange={(event) => { setProductCategory(event.target.value); setProductPage(1); }}><option value="">All categories</option>{categories.map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
        <label><span>Stock</span><select value={productStock} onChange={(event) => { setProductStock(event.target.value); setProductPage(1); }}><option value="">Any stock</option><option value="in_stock">In stock</option><option value="limited">Limited</option><option value="order_in">Order in</option><option value="unavailable">Unavailable</option></select></label>
        <label><span>Review status</span><select value={productReviewStatus} onChange={(event) => { setProductReviewStatus(event.target.value); setProductPage(1); }}><option value="">Any review status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="needs_changes">Needs changes</option><option value="rejected">Rejected</option></select></label>
        <label><span>Listing status</span><select value={productListingStatus} onChange={(event) => { setProductListingStatus(event.target.value); setProductPage(1); }}><option value="">Any listing status</option><option value="draft">Draft</option><option value="published">Published</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
        <label><span>Minimum price ex GST</span><input type="number" min="0" value={productMinimumPrice} onChange={(event) => { setProductMinimumPrice(event.target.value); setProductPage(1); }} placeholder="$0" /></label>
        <label><span>Maximum price ex GST</span><input type="number" min="0" value={productMaximumPrice} onChange={(event) => { setProductMaximumPrice(event.target.value); setProductPage(1); }} placeholder="No maximum" /></label>
        <label><span>Sort by</span><select value={productSort} onChange={(event) => { setProductSort(event.target.value); setProductPage(1); }}><option value="priority-desc">Review priority</option><option value="updated-desc">Recently updated</option><option value="name-asc">Product A to Z</option><option value="supplier-asc">Wholesaler A to Z</option><option value="brand-asc">Brand A to Z</option><option value="model-asc">Model code A to Z</option><option value="category-asc">Category</option><option value="price-asc">Price low to high</option><option value="price-desc">Price high to low</option><option value="stock-asc">Stock status</option><option value="lead-asc">Lead time</option><option value="warranty-desc">Warranty longest first</option></select></label>
        <button type="button" onClick={() => { setProductSearch(""); setProductWholesaler(""); setProductBrand(""); setProductModel(""); setProductCategory(""); setProductStock(""); setProductReviewStatus(""); setProductListingStatus(""); setProductMinimumPrice(""); setProductMaximumPrice(""); setProductPage(1); }}>Clear filters</button>
      </div></div>
      <WorkspaceListControls page={productPagination.page} pageCount={productPagination.pageCount} pageSize={productPagination.pageSize} total={productPagination.total} hasNext={productPagination.hasNext} saved={productViewSaved} busy={productViewBusy} onPage={setProductPage} onPageSize={(size) => { setProductPageSize(size); setProductPage(1); }} onSave={() => void saveProductView()} onReset={() => void resetProductView()} />
      <div className="admin-catalogue-list tlink-data-table" role="table" aria-label="Catalogue review products"><div className="admin-catalogue-columns" aria-hidden="true"><span>Wholesaler</span><span>Brand</span><span>Model code</span><span>Product</span><span>Category</span><span>Price ex GST</span><span>Minimum order</span><span>Stock</span><span>Lead time</span><span>Warranty</span><span>Review</span><span>Listing</span><span>Linked kit</span><span>Action</span></div>
        {products.length ? products.map((product) => {
          const decision = productReview[product.id] || { reviewStatus: product.reviewStatus, reviewNote: product.reviewNote || "", listingStatus: product.listingStatus };
          return <article key={product.id}><strong title={`${product.supplierName} | ${product.supplierEmail}`}>{product.supplierName}</strong><span>{product.brand}</span><b>{product.modelNumber}</b><strong title={product.name}>{product.name}{product.isSynthetic && <i className="admin-synthetic-marker">Demo</i>}</strong><span>{readable(product.category)}</span><strong>${(product.unitPriceCentsExGst / 100).toLocaleString("en-AU", { minimumFractionDigits: 2 })}</strong><span>{product.minOrderQty}</span><span className={`marketplace-stock status-${product.stockStatus}`}>{readable(product.stockStatus)}</span><span>{product.leadTimeDays ? `${product.leadTimeDays} days` : "Available now"}</span><span>{product.warrantyYears ? `${product.warrantyYears} years` : "Not stated"}</span><span className={`admin-pill admin-pill-${product.reviewStatus}`}>{readable(product.reviewStatus)}</span><span className={`admin-pill admin-pill-${product.listingStatus}`}>{readable(product.listingStatus)}</span><span>{product.linkedCount || "None"}</span><details className="admin-product-review-details"><summary>Review product</summary><div className="admin-product-review"><label>Review decision<select value={decision.reviewStatus} onChange={(event) => setProductReview((current) => ({ ...current, [product.id]: { ...decision, reviewStatus: event.target.value } }))}><option value="pending">Pending</option><option value="approved">Approved</option><option value="needs_changes">Needs changes</option><option value="rejected">Rejected</option></select></label><label>Listing availability<select disabled={role === "reviewer"} value={decision.listingStatus} onChange={(event) => setProductReview((current) => ({ ...current, [product.id]: { ...decision, listingStatus: event.target.value } }))}><option value="draft">Draft</option><option value="published">Published</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label><label className="full">Review note<textarea value={decision.reviewNote} onChange={(event) => setProductReview((current) => ({ ...current, [product.id]: { ...decision, reviewNote: event.target.value } }))} placeholder="Required when requesting changes or rejecting a product." /></label><button type="button" onClick={() => void reviewProduct(product)}>Save catalogue decision</button></div></details></article>;
        }) : <p className="admin-empty">No products match this catalogue search.</p>}
      </div>
    </section>
  </div>;
}
