import Image from "next/image";

const journeyStages = [
  { number: "01", title: "Understand", text: "Tell us what matters at home." },
  { number: "02", title: "Prioritise", text: "See the right order for upgrades." },
  { number: "03", title: "Take action", text: "Leave with one clear next move." },
] as const;

export function CustomerJourneyScene() {
  return (
    <section
      className="customer-journey-scene"
      aria-labelledby="customer-journey-title"
    >
      <div className="customer-scene-volume" aria-hidden="true">
        <div className="customer-scene-home">
          <Image
            className="customer-scene-render"
            src="/aea-immersive-home-journey.webp"
            alt=""
            width="1731"
            height="909"
            sizes="(max-width: 720px) 100vw, 55vw"
            priority
          />
        </div>
      </div>

      <div className="customer-journey-route">
        <h2 id="customer-journey-title" className="customer-route-eyebrow">Your journey</h2>
        <ol>
          {journeyStages.map((stage) => (
            <li key={stage.number}>
              <b>{stage.number}</b>
              <span><strong>{stage.title}</strong><small>{stage.text}</small></span>
            </li>
          ))}
        </ol>
        <p><span aria-hidden="true" /> Private from the first step</p>
      </div>
    </section>
  );
}
