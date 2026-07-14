"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  supplierName: string;
  supplierWebsite: string;
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

export function InstallerProductMarketplace({ user }: { user: User }) {
  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("Loading approved wholesaler products...");

  const load = useCallback(async () => {
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/product-marketplace", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The trade catalogue could not be loaded.",
        );
      setProducts(result.products || []);
      setStatus("");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The trade catalogue could not be loaded.",
      );
    }
  }, [user]);
  useEffect(() => {
    // The async loader owns the approved marketplace state for this account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      (item) =>
        (!category || item.category === category) &&
        (!term ||
          `${item.modelNumber} ${item.brand} ${item.name} ${item.description} ${item.supplierName}`
            .toLowerCase()
            .includes(term)),
    );
  }, [products, search, category]);

  return (
    <section
      className="dashboard-panel installer-marketplace"
      aria-labelledby="installer-marketplace-title"
    >
      <div className="dashboard-panel-heading">
        <span>Approved wholesale catalogue</span>
        <h2 id="installer-marketplace-title">
          Compare equipment and complete kits
        </h2>
        <p>
          Prices are wholesaler-supplied before GST. Confirm stock, freight,
          final trade terms and technical suitability directly before ordering.
        </p>
      </div>
      <div className="marketplace-filterbar">
        <input
          type="search"
          placeholder="Search model, brand, product or wholesaler"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {Object.entries(categoryLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {status && <p className="dashboard-settings-status">{status}</p>}
      {filtered.length ? (
        <div className="marketplace-product-grid">
          {filtered.map((product) => (
            <article key={product.id}>
              <header>
                <span>{product.supplierName}</span>
                <strong>
                  {product.brand} · {product.modelNumber}
                </strong>
                <h3>{product.name}</h3>
              </header>
              <p>{product.description}</p>
              <div className="marketplace-price">
                <strong>
                  {money.format(product.unitPriceCentsExGst / 100)}
                </strong>
                <span>
                  ex GST ·{" "}
                  {money.format((product.unitPriceCentsExGst * 1.1) / 100)} inc
                  GST
                </span>
              </div>
              <ul>
                <li>
                  Minimum {product.minOrderQty} {product.unitLabel}; order in{" "}
                  {product.orderIncrement}s
                </li>
                <li>
                  {product.stockStatus.replaceAll("_", " ")}
                  {product.leadTimeDays
                    ? ` · ${product.leadTimeDays} day lead time`
                    : ""}
                </li>
                <li>
                  {product.warrantyYears
                    ? `${product.warrantyYears} year stated product warranty`
                    : "Warranty term not stated"}
                </li>
              </ul>
              {product.dependencies.length > 0 && (
                <details>
                  <summary>
                    {product.dependencies.length} linked kit item
                    {product.dependencies.length === 1 ? "" : "s"}
                  </summary>
                  {product.dependencies.map((item) => (
                    <div key={`${item.productId}-${item.relationship}`}>
                      <strong>
                        {item.relationship}: {item.brand} {item.modelNumber}
                      </strong>
                      <span>
                        {item.defaultQty} × {item.name} ·{" "}
                        {money.format(item.unitPriceCentsExGst / 100)} ex GST
                        each
                      </span>
                      {item.note && <small>{item.note}</small>}
                    </div>
                  ))}
                </details>
              )}
              <div className="marketplace-product-actions">
                {product.datasheetUrl && (
                  <a
                    href={product.datasheetUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Product details
                  </a>
                )}
                {product.supplierWebsite && (
                  <a
                    href={product.supplierWebsite}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Wholesaler website
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        !status && (
          <div className="dashboard-empty-state">
            <strong>No approved products match this view</strong>
            <p>
              Change the search or check again after wholesalers publish
              reviewed catalogue items.
            </p>
          </div>
        )
      )}
    </section>
  );
}
