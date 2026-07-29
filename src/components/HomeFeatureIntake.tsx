"use client";

import {
  customerHomeFeatureSections as rawCustomerHomeFeatureSections,
  updateHomeFeatureSelection,
} from "@/lib/customer-projects.mjs";
import styles from "./HomeFeatureIntake.module.css";

type HomeFeatureQuestion = {
  id: string;
  label: string;
  help: string;
  mode: "single" | "multiple";
  noneValue?: string;
  unknownValue?: string;
  options: Array<[string, string]>;
};

type HomeFeatureSection = {
  id: string;
  title: string;
  description: string;
  questions: HomeFeatureQuestion[];
};

const customerHomeFeatureSections =
  rawCustomerHomeFeatureSections as unknown as HomeFeatureSection[];

export function HomeFeatureIntake({
  selected,
  onChange,
  idPrefix,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  return (
    <div className={styles.sections}>
      {customerHomeFeatureSections.map((section) => {
        const headingId = `${idPrefix}-section-${section.id}`;
        return (
          <section
            className={styles.section}
            aria-labelledby={headingId}
            key={section.id}
          >
            <header className={styles.sectionHeader}>
              <h3 id={headingId}>{section.title}</h3>
              <p>{section.description}</p>
            </header>
            {section.questions.map((question) => {
              const helpId = question.help
                ? `${idPrefix}-${question.id}-help`
                : undefined;
              return (
                <fieldset
                  id={`${idPrefix}-${question.id}`}
                  className={styles.question}
                  aria-describedby={helpId}
                  key={question.id}
                >
                  <legend>{question.label}</legend>
                  {question.help ? (
                    <p className={styles.help} id={helpId}>
                      {question.help}
                    </p>
                  ) : null}
                  <div className={styles.choices}>
                    {question.options.map(([value, label]) => {
                      const checked = selected.includes(value);
                      return (
                        <label
                          className={`${styles.choice} ${
                            checked ? styles.choiceSelected : ""
                          }`}
                          key={value}
                        >
                          <input
                            type={
                              question.mode === "single" ? "radio" : "checkbox"
                            }
                            name={`${idPrefix}-${question.id}`}
                            value={value}
                            checked={checked}
                            onChange={(event) =>
                              onChange(
                                updateHomeFeatureSelection(
                                  selected,
                                  question.id,
                                  value,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
