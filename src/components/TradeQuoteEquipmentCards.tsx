import { SOLAR_EQUIPMENT_LABELS, solarEquipmentDescription, type SolarDesignEquipment } from "@/lib/trade-solar-equipment";
import styles from "./TradeQuoteEquipmentCards.module.css";

export function TradeQuoteEquipmentCards({ items, title = "Selected equipment" }: { items: SolarDesignEquipment; title?: string }) {
  if (!items.length) return null;
  return <section className={styles.section} aria-label={title}><h3>{title}</h3><div className={styles.grid}>{items.map((item) => <article key={item.id} className={styles.card}>
    {item.imageUrl && <div className={styles.image}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Public manufacturer image selected by the business. */}
      <img src={item.imageUrl} alt={item.name} loading="lazy" referrerPolicy="no-referrer" />
    </div>}
    <div><span>{item.quantity} × {SOLAR_EQUIPMENT_LABELS[item.kind]}</span><strong>{item.name}</strong><small>{[item.manufacturer, item.model].filter(Boolean).join(" · ")}</small>
      {solarEquipmentDescription(item) && <small>{solarEquipmentDescription(item)}</small>}
      {item.warrantyYears !== undefined && <small>{item.warrantyYears} year warranty</small>}
      {item.datasheetUrl && <a href={item.datasheetUrl} target="_blank" rel="noopener noreferrer">Product datasheet ↗</a>}
    </div>
  </article>)}</div></section>;
}
