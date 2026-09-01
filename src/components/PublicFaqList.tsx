import styles from "./FaqAccordion.module.css";

export type PublicFaq = {
  question: string;
  answer: string;
};

export function PublicFaqList({ faqs }: { faqs: readonly PublicFaq[] }) {
  return <div className={styles.list}>
    {faqs.map((faq) => <details className={styles.item} key={faq.question}>
      <summary className={styles.question}>{faq.question}</summary>
      <p className={styles.answer}>{faq.answer}</p>
    </details>)}
  </div>;
}
