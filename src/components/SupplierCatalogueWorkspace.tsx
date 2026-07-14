"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type ProductDependency = {
  linkedProductId: string;
  relationship: "required" | "recommended" | "compatible";
  defaultQty: number;
  note: string;
  linkedModelNumber?: string;
  linkedName?: string;
};
type SupplierProduct = {
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
  listingStatus: string;
  reviewStatus: string;
  reviewNote: string;
  dependencies: ProductDependency[];
  updatedAt: string;
};

type Draft = {
  id: string;
  modelNumber: string;
  brand: string;
  name: string;
  category: string;
  description: string;
  priceExGst: string;
  minOrderQty: number;
  orderIncrement: number;
  unitLabel: string;
  stockStatus: string;
  leadTimeDays: number;
  warrantyYears: number;
  datasheetUrl: string;
  listingStatus: string;
  dependencies: ProductDependency[];
};

const categories = [
  ["assessment", "Assessment equipment"],
  ["solar", "Solar"],
  ["battery", "Battery"],
  ["heating-cooling", "Heating and cooling"],
  ["hot-water", "Hot water"],
  ["insulation-draughts", "Insulation and draught control"],
  ["ev-charging", "EV charging"],
  ["electrical", "Electrical"],
  ["plumbing", "Plumbing"],
  ["mounting-hardware", "Mounting and hardware"],
  ["controls", "Controls and monitoring"],
  ["other", "Other"],
] as const;
const emptyDraft: Draft = {
  id: "",
  modelNumber: "",
  brand: "",
  name: "",
  category: "",
  description: "",
  priceExGst: "",
  minOrderQty: 1,
  orderIncrement: 1,
  unitLabel: "each",
  stockStatus: "order_in",
  leadTimeDays: 0,
  warrantyYears: 0,
  datasheetUrl: "",
  listingStatus: "draft",
  dependencies: [],
};
const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});
const csvHeaders = [
  "model_number",
  "brand",
  "name",
  "category",
  "description",
  "price_ex_gst",
  "min_order_qty",
  "order_increment",
  "unit_label",
  "stock_status",
  "lead_time_days",
  "warranty_years",
  "datasheet_url",
  "listing_status",
  "dependency_model_numbers",
  "dependency_relationships",
  "dependency_default_quantities",
  "dependency_notes",
];

function csvLine(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll('"', '""')}"`)
    .join(",");
}

function pipeValues(value: string) {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pipeColumns(value: string) {
  return value.split("|").map((item) => item.trim());
}

function parseCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SupplierCatalogueWorkspace({
  user,
  businessName,
}: {
  user: User;
  businessName: string;
}) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState("");

  const loadProducts = useCallback(async () => {
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/supplier-products", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(
          result.error || "The product catalogue could not be loaded.",
        );
      setProducts(result.products || []);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The product catalogue could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    // The async loader owns the remote catalogue state for this authenticated account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProducts();
  }, [loadProducts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? products.filter((item) =>
          `${item.modelNumber} ${item.brand} ${item.name} ${item.category}`
            .toLowerCase()
            .includes(term),
        )
      : products;
  }, [products, search]);
  const liveCount = products.filter(
    (item) =>
      item.listingStatus === "published" && item.reviewStatus === "approved",
  ).length;
  const reviewCount = products.filter(
    (item) => item.reviewStatus === "pending",
  ).length;
  const availableCount = products.filter(
    (item) => item.stockStatus === "in_stock" || item.stockStatus === "limited",
  ).length;

  function editProduct(product: SupplierProduct) {
    setDraft({
      id: product.id,
      modelNumber: product.modelNumber,
      brand: product.brand,
      name: product.name,
      category: product.category,
      description: product.description,
      priceExGst: (product.unitPriceCentsExGst / 100).toFixed(2),
      minOrderQty: product.minOrderQty,
      orderIncrement: product.orderIncrement,
      unitLabel: product.unitLabel,
      stockStatus: product.stockStatus,
      leadTimeDays: product.leadTimeDays,
      warrantyYears: product.warrantyYears,
      datasheetUrl: product.datasheetUrl,
      listingStatus: product.listingStatus,
      dependencies: product.dependencies.map((item) => ({ ...item })),
    });
    setStatus(
      `Editing ${product.modelNumber}. Saving material changes sends the item back for review.`,
    );
    document
      .getElementById("supplier-product-editor")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function dependencyFor(productId: string) {
    return draft.dependencies.find(
      (item) => item.linkedProductId === productId,
    );
  }
  function toggleDependency(productId: string) {
    setDraft((current) => ({
      ...current,
      dependencies: current.dependencies.some(
        (item) => item.linkedProductId === productId,
      )
        ? current.dependencies.filter(
            (item) => item.linkedProductId !== productId,
          )
        : [
            ...current.dependencies,
            {
              linkedProductId: productId,
              relationship: "recommended",
              defaultQty: 1,
              note: "",
            },
          ],
    }));
  }
  function updateDependency(
    productId: string,
    changes: Partial<ProductDependency>,
  ) {
    setDraft((current) => ({
      ...current,
      dependencies: current.dependencies.map((item) =>
        item.linkedProductId === productId ? { ...item, ...changes } : item,
      ),
    }));
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    const price = Number(draft.priceExGst);
    if (!Number.isFinite(price) || price <= 0) {
      setStatus("Enter a valid unit price before GST.");
      return;
    }
    setBusy(true);
    setStatus(
      draft.id
        ? "Updating product and linked items..."
        : "Adding product to the catalogue...",
    );
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/supplier-products", {
        method: draft.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...draft,
          unitPriceCentsExGst: Math.round(price * 100),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok)
        throw new Error(result.error || "The product could not be saved.");
      setProducts(result.products || []);
      setDraft(emptyDraft);
      setStatus(
        "Product saved. Published items become visible to installers after catalogue review.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The product could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  function downloadCsvTemplate() {
    const examples = [
      [
        "EASYFIT-250",
        "Example brand",
        "Easy-fit connection kit",
        "plumbing",
        "Valves and connection hardware for the example 250 litre system.",
        "285.00",
        "1",
        "1",
        "kit",
        "in_stock",
        "0",
        "2",
        "https://supplier.example/easy-fit-kit",
        "draft",
        "",
        "",
        "",
        "",
      ],
      [
        "PLINTH-250",
        "Example brand",
        "Equipment plinth",
        "mounting-hardware",
        "Optional equipment plinth compatible with the example hot water system.",
        "145.00",
        "1",
        "1",
        "each",
        "limited",
        "3",
        "5",
        "https://supplier.example/plinth",
        "draft",
        "",
        "",
        "",
        "",
      ],
      [
        "HPHW-250",
        "Example brand",
        "250 L heat pump hot water system",
        "hot-water",
        "250 litre heat pump system with stated application and inclusions.",
        "2450.00",
        "1",
        "1",
        "each",
        "order_in",
        "10",
        "7",
        "https://supplier.example/heat-pump",
        "draft",
        "EASYFIT-250|PLINTH-250",
        "required|recommended",
        "1|1",
        "Required connection kit|Offer where the site needs a raised base",
      ],
    ];
    const blob = new Blob(
      [
        `${csvHeaders.join(",")}\n${examples.map(csvLine).join("\n")}\n`,
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "aea-wholesaler-catalogue-demo.csv";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importCsv(file: File) {
    setBusy(true);
    setStatus("Validating and importing catalogue rows...");
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2)
        throw new Error(
          "The CSV needs a header row and at least one product row.",
        );
      const headers = rows[0].map((value) =>
        value
          .trim()
          .toLowerCase()
          .replace(/^\uFEFF/, ""),
      );
      const missing = csvHeaders.filter((header) => !headers.includes(header));
      if (missing.length)
        throw new Error(
          `The CSV is missing: ${missing.join(", ")}. Use the template to preserve every required column.`,
        );
      const index = Object.fromEntries(
        headers.map((header, position) => [header, position]),
      );
      const productsToImport = rows.slice(1).map((values, rowIndex) => {
        const dependencyModels = pipeValues(
          values[index.dependency_model_numbers] || "",
        );
        const dependencyRelationships = pipeColumns(
          values[index.dependency_relationships] || "",
        );
        const dependencyQuantities = pipeColumns(
          values[index.dependency_default_quantities] || "",
        );
        const dependencyNotes = pipeColumns(
          values[index.dependency_notes] || "",
        );
        if (
          !dependencyModels.length &&
          (dependencyRelationships.some(Boolean) ||
            dependencyQuantities.some(Boolean) ||
            dependencyNotes.some(Boolean))
        ) {
          throw new Error(
            `CSV row ${rowIndex + 2} has dependency settings without a dependency model number.`,
          );
        }
        return {
          modelNumber: values[index.model_number] || "",
          brand: values[index.brand] || "",
          name: values[index.name] || "",
          category: values[index.category] || "",
          description: values[index.description] || "",
          unitPriceCentsExGst: Math.round(
            Number(values[index.price_ex_gst]) * 100,
          ),
          minOrderQty: Number(values[index.min_order_qty]),
          orderIncrement: Number(values[index.order_increment]),
          unitLabel: values[index.unit_label] || "each",
          stockStatus: values[index.stock_status] || "order_in",
          leadTimeDays: Number(values[index.lead_time_days] || 0),
          warrantyYears: Number(values[index.warranty_years] || 0),
          datasheetUrl: values[index.datasheet_url] || "",
          listingStatus: values[index.listing_status] || "draft",
          dependencies: dependencyModels.map((linkedModelNumber, position) => ({
            linkedModelNumber,
            relationship:
              dependencyRelationships[position] || "recommended",
            defaultQty: Number(dependencyQuantities[position] || 1),
            note: dependencyNotes[position] || "",
          })),
        };
      });
      const token = await user.getIdToken();
      let imported = 0;
      for (let offset = 0; offset < productsToImport.length; offset += 100) {
        const response = await fetch("/api/supplier-products", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            products: productsToImport.slice(offset, offset + 100),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok)
          throw new Error(
            result.error || `The import stopped after ${imported} rows.`,
          );
        imported += Number(result.imported || 0);
        setProducts(result.products || []);
      }
      setStatus(
        `${imported} catalogue row${imported === 1 ? "" : "s"} imported or updated with matching model dependencies. Imported items are pending review.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "The catalogue CSV could not be imported.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section
        className="dashboard-status-grid supplier-status-grid"
        aria-label="Catalogue status"
      >
        <article>
          <span>Catalogue</span>
          <strong>
            {products.length} product{products.length === 1 ? "" : "s"}
          </strong>
          <small>Owned and editable by {businessName}</small>
        </article>
        <article>
          <span>Live to installers</span>
          <strong>{liveCount} approved</strong>
          <small>Published and catalogue-reviewed items</small>
        </article>
        <article>
          <span>Awaiting review</span>
          <strong>{reviewCount} pending</strong>
          <small>Material edits return an item to review</small>
        </article>
        <article>
          <span>Stock position</span>
          <strong>{availableCount} available</strong>
          <small>In-stock or limited-stock catalogue items</small>
        </article>
      </section>

      <section className="dashboard-panel supplier-boundary">
        <div>
          <span>Wholesaler workspace</span>
          <h2>Products, pricing and install-ready bundles</h2>
          <p>
            Wholesaler accounts never receive or view household opportunities.
            Your catalogue supports verified installers with clear ex-GST
            pricing, order rules, availability and compatible add-ons.
          </p>
        </div>
        <aside>
          <strong>Commercial clarity</strong>
          <ul>
            <li>Prices are stored and shown before GST</li>
            <li>
              Minimum quantity and order increments prevent invalid orders
            </li>
            <li>Required and recommended products build complete kits</li>
            <li>Installer access requires an approved trade account</li>
          </ul>
        </aside>
      </section>

      <div className="supplier-catalogue-layout">
        <section className="dashboard-panel supplier-product-library">
          <div className="dashboard-panel-heading">
            <span>Product library</span>
            <h2>Manage the full catalogue</h2>
            <p>
              Search, review and edit model-level listings. Archiving preserves
              the record without showing it to installers.
            </p>
          </div>
          <div className="supplier-bulk-import">
            <div>
              <strong>Bulk catalogue import</strong>
              <span>
                Import up to 100 rows per secure batch. Existing model numbers
                and dependency bundles are updated and returned to review.
              </span>
              <small>
                The demo shows valid categories, ex-GST pricing, order rules
                and pipe-separated linked models. Keep dependent products in
                the same file or add them to the catalogue first.
              </small>
            </div>
            <div>
              <button type="button" onClick={downloadCsvTemplate}>
                Download completed CSV demo
              </button>
              <label>
                <span>{busy ? "Importing..." : "Choose catalogue CSV"}</span>
                <input
                  disabled={busy}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importCsv(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          <input
            className="supplier-search"
            type="search"
            placeholder="Search model, brand, name or category"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading ? (
            <p className="dashboard-settings-status">Loading catalogue...</p>
          ) : filtered.length ? (
            <div className="supplier-product-list">
              {filtered.map((product) => (
                <article key={product.id}>
                  <header>
                    <div>
                      <span>
                        {product.brand} · {product.modelNumber}
                      </span>
                      <h3>{product.name}</h3>
                    </div>
                    <div>
                      <strong
                        className={`admin-pill admin-pill-${product.listingStatus}`}
                      >
                        {readable(product.listingStatus)}
                      </strong>
                      <strong
                        className={`admin-pill admin-pill-${product.reviewStatus}`}
                      >
                        {readable(product.reviewStatus)}
                      </strong>
                    </div>
                  </header>
                  <p>{product.description}</p>
                  <div className="supplier-product-facts">
                    <span>
                      <strong>
                        {money.format(product.unitPriceCentsExGst / 100)}
                      </strong>{" "}
                      ex GST
                    </span>
                    <span>
                      MOQ {product.minOrderQty} {product.unitLabel}
                    </span>
                    <span>{readable(product.stockStatus)}</span>
                    <span>
                      {product.leadTimeDays
                        ? `${product.leadTimeDays} day lead time`
                        : "No stated lead time"}
                    </span>
                    <span>
                      {product.dependencies.length} linked item
                      {product.dependencies.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {product.reviewNote && (
                    <small className="supplier-review-note">
                      Review note: {product.reviewNote}
                    </small>
                  )}
                  <button type="button" onClick={() => editProduct(product)}>
                    Edit product and dependencies
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-state">
              <strong>No products in this view</strong>
              <p>Add the first model or change the catalogue search.</p>
            </div>
          )}
        </section>

        <form
          id="supplier-product-editor"
          className="dashboard-panel supplier-product-editor"
          onSubmit={saveProduct}
        >
          <div className="dashboard-panel-heading">
            <span>{draft.id ? "Edit listing" : "New listing"}</span>
            <h2>
              {draft.id
                ? `${draft.brand} ${draft.modelNumber}`
                : "Add a product model"}
            </h2>
            <p>
              Use the sellable model number and unit price before GST. Avoid
              confidential rebate arrangements or customer-specific pricing.
            </p>
          </div>
          <div className="supplier-form-grid">
            <label>
              Model number
              <input
                required
                value={draft.modelNumber}
                onChange={(event) =>
                  setDraft({ ...draft, modelNumber: event.target.value })
                }
              />
            </label>
            <label>
              Brand
              <input
                required
                value={draft.brand}
                onChange={(event) =>
                  setDraft({ ...draft, brand: event.target.value })
                }
              />
            </label>
            <label className="full">
              Product name
              <input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              Category
              <select
                required
                value={draft.category}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
              >
                <option value="">Choose category</option>
                {categories.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit label
              <input
                required
                value={draft.unitLabel}
                onChange={(event) =>
                  setDraft({ ...draft, unitLabel: event.target.value })
                }
                placeholder="each, kit, carton"
              />
            </label>
            <label>
              Unit price ex GST ($)
              <input
                required
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={draft.priceExGst}
                onChange={(event) =>
                  setDraft({ ...draft, priceExGst: event.target.value })
                }
              />
            </label>
            <label>
              Minimum order quantity
              <input
                required
                type="number"
                min="1"
                value={draft.minOrderQty}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    minOrderQty: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Order increment
              <input
                required
                type="number"
                min="1"
                value={draft.orderIncrement}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    orderIncrement: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Stock status
              <select
                value={draft.stockStatus}
                onChange={(event) =>
                  setDraft({ ...draft, stockStatus: event.target.value })
                }
              >
                <option value="in_stock">In stock</option>
                <option value="limited">Limited stock</option>
                <option value="order_in">Order in</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
            <label>
              Lead time in days
              <input
                type="number"
                min="0"
                max="3650"
                value={draft.leadTimeDays}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    leadTimeDays: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Warranty in years
              <input
                type="number"
                min="0"
                max="100"
                value={draft.warrantyYears}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    warrantyYears: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="full">
              HTTPS datasheet or product page
              <input
                type="url"
                value={draft.datasheetUrl}
                onChange={(event) =>
                  setDraft({ ...draft, datasheetUrl: event.target.value })
                }
              />
            </label>
            <label className="full">
              Product description
              <textarea
                required
                minLength={20}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Capacity, application, key technical characteristics, inclusions and installation constraints."
              />
            </label>
            <label>
              Listing status
              <select
                value={draft.listingStatus}
                onChange={(event) =>
                  setDraft({ ...draft, listingStatus: event.target.value })
                }
              >
                <option value="draft">Draft</option>
                <option value="published">Publish after approval</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>
          <fieldset className="supplier-dependencies">
            <legend>Linked products and kit dependencies</legend>
            <p>
              Select products from this catalogue, then state whether each item
              is required, recommended or simply compatible.
            </p>
            {products.filter(
              (item) =>
                item.id !== draft.id && item.listingStatus !== "archived",
            ).length ? (
              <div>
                {products
                  .filter(
                    (item) =>
                      item.id !== draft.id && item.listingStatus !== "archived",
                  )
                  .map((item) => {
                    const dependency = dependencyFor(item.id);
                    return (
                      <article
                        className={dependency ? "selected" : ""}
                        key={item.id}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={Boolean(dependency)}
                            onChange={() => toggleDependency(item.id)}
                          />
                          <span>
                            <strong>
                              {item.brand} {item.modelNumber}
                            </strong>
                            <small>{item.name}</small>
                          </span>
                        </label>
                        {dependency && (
                          <div>
                            <select
                              aria-label={`Relationship for ${item.modelNumber}`}
                              value={dependency.relationship}
                              onChange={(event) =>
                                updateDependency(item.id, {
                                  relationship: event.target
                                    .value as ProductDependency["relationship"],
                                })
                              }
                            >
                              <option value="required">Required</option>
                              <option value="recommended">Recommended</option>
                              <option value="compatible">Compatible</option>
                            </select>
                            <input
                              aria-label={`Default quantity for ${item.modelNumber}`}
                              type="number"
                              min="1"
                              value={dependency.defaultQty}
                              onChange={(event) =>
                                updateDependency(item.id, {
                                  defaultQty: Number(event.target.value),
                                })
                              }
                            />
                            <input
                              aria-label={`Link note for ${item.modelNumber}`}
                              placeholder="Optional fit or ordering note"
                              value={dependency.note}
                              onChange={(event) =>
                                updateDependency(item.id, {
                                  note: event.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            ) : (
              <p className="supplier-dependency-empty">
                Save at least one other product before creating a linked kit.
              </p>
            )}
          </fieldset>
          <div className="supplier-editor-actions">
            <button className="btn" disabled={busy}>
              {busy
                ? "Saving..."
                : draft.id
                  ? "Save product changes"
                  : "Add product"}
            </button>
            {draft.id && (
              <button
                type="button"
                onClick={() => {
                  setDraft(emptyDraft);
                  setStatus("Product editor cleared.");
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
          {status && (
            <p className="dashboard-settings-status" role="status">
              {status}
            </p>
          )}
        </form>
      </div>
    </>
  );
}
