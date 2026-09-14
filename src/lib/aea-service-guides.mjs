// Page-only guidance. Keep detailed service content out of client enquiry bundles.
export const AEA_SERVICE_GUIDES = Object.freeze({
  "smoke-alarm-blind-safety": {
    title: "A practical check of every alarm and accessible corded blind",
    introduction: "An alarm that sounds when its test button is pressed still needs its location, age, condition and power supply considered. Our visit brings those checks together with the accessible blind and curtain cords, so the rental provider has a clear record of both services.",
    steps: [
      ["Identify and inspect", "We record each smoke alarm and inspect its position, condition, expiry and power supply. Accessible corded blinds and curtains are checked for loose cords and the condition of their safety devices."],
      ["Test, clean and address standard items", "We test alarm operation, clean alarms and replace accessible batteries where required. The price includes standard replacement alarms, cord anchors and warning labels. Any work requiring an electrician is arranged through an appropriately licensed electrician."],
      ["Record the outcome", "Your combined visit report records the checked items, evidence, work completed, unresolved defects and the next smoke alarm check due date. A completed visit does not turn an unresolved fault into a pass."],
    ],
    preparation: ["Give us the property address, access contact and date of the last smoke alarm service.", "Tell us about beeping, damaged or missing alarms and any unusual alarm system before the visit.", "Arrange access to rooms containing alarms and corded window coverings; keep pets secure and access clear.", "Keep existing service records available. You do not need to climb up, remove alarms or touch wiring."],
    outcomeTitle: "Support continues between scheduled visits",
    outcome: "Between-visit fault callouts for the covered smoke and blind service are included. Contact AEA when a fault is noticed instead of waiting for the next annual visit. We record the issue and arrange the appropriate response. If work falls outside the standard included items, we explain the scope and obtain authorisation before additional work proceeds.",
    related: ["electrical-safety-check", "gas-safety-check", "minimum-rental-standards"],
  },
  "gas-safety-check": {
    title: "One property price, with a record for the gas work performed",
    introduction: "A rental gas check involves more than confirming that a heater lights. The gasfitter considers the gas installation and appliances within the tenancy scope, carries out the required servicing and safety checks, and records the results. Additional gas appliances do not increase AEA's inspection price.",
    steps: [
      ["Confirm appliances and history", "We confirm the property details, appliance locations and any known faults or previous service records. The gas work is allocated to a gasfitter with the required Type A appliance servicing endorsement."],
      ["Service and test", "The gasfitter performs the applicable installation and appliance checks, including the relevant ventilation, flue, combustion and safety checks. The requirements depend on the appliance and installation; the professional service record captures the actual work and findings."],
      ["Explain findings and follow-up", "The completed records identify the appliances serviced, defects, limitations and any action required. Unsafe equipment is dealt with through the gasfitter's appropriate safety response. Repairs and replacement parts are separately explained and authorised."],
    ],
    preparation: ["List gas heaters, cooktops, ovens, hot-water systems and other gas appliances, including outdoor locations.", "Provide previous check dates, servicing records and any known operating problems.", "Arrange safe access to appliances and the meter, with the gas supply available where required for testing.", "Do not attempt to dismantle an appliance or investigate a suspected gas leak yourself."],
    outcomeTitle: "An unsafe appliance needs action, not just a report",
    outcome: "The findings tell you which appliance or installation item needs attention and why. A limitation such as unavailable access remains visible until the required work can be completed. Retain the full service records with your property documents. The gasfitter's regulator reporting obligation is separate from sending the customer a combined visit summary.",
    related: ["electrical-safety-check", "smoke-alarm-blind-safety", "minimum-rental-standards"],
  },
  "electrical-safety-check": {
    title: "Licensed inspection, electrical testing and clear next actions",
    introduction: "An electrical safety check assesses the installation against the applicable inspection requirements. It combines a visual inspection with testing by a licensed electrician. A switchboard photograph or a household safety-switch button check alone is not the complete professional inspection.",
    steps: [
      ["Review the installation", "The electrician confirms the property and inspection history, then inspects the accessible installation and equipment. Known faults and access restrictions are recorded so that the scope is clear."],
      ["Complete the required testing", "The inspection includes the applicable switchboard, earthing, circuit and safety-switch checks. Test results and limitations are recorded against the required inspection standard, rather than reduced to an unexplained overall tick."],
      ["Issue findings and explain defects", "The completed safety-check report identifies the electrician, work performed, results and required action. Any separately authorised electrical repair or installation work has its own Certificate of Electrical Safety requirements."],
    ],
    preparation: ["Provide the most recent electrical safety-check report and describe any known faults.", "Arrange access to the switchboard, rooms and accessible electrical equipment.", "Tell us about life-support equipment, medical devices, alarms or equipment affected by a power interruption before the appointment.", "The electrician will explain any interruption needed for testing. Do not remove covers or expose wiring yourself."],
    outcomeTitle: "Understand the report and any separate certificate",
    outcome: "Your safety-check report records the condition and test results found at the visit. Where a defect needs rectification, we explain the next step and any separately authorised work. A Certificate of Electrical Safety relates to the electrical work for which it is issued; it does not replace the rental safety-check record or make unrelated unresolved defects compliant.",
    related: ["smoke-alarm-blind-safety", "gas-safety-check", "minimum-rental-standards"],
  },
  "onsite-energy-assessment": {
    title: "Turn comfort problems into a practical order of work",
    introduction: "Choose this visit when you want help understanding a cold, hot or costly-to-run home without commissioning a formal rating. We discuss how the home is used, inspect accessible features and explain which changes are worth investigating first for your priorities.",
    steps: [
      ["Start with how the home feels", "Tell us which rooms are uncomfortable, when problems occur and what you want to achieve. Recent bills, appliance details and any previous advice can help give the visit context."],
      ["Walk through the home", "We consider accessible insulation, draughts, glazing, shading and major appliances alongside your observations. The assessment is based on what can be safely observed and the information available; hidden construction cannot be assumed."],
      ["Prioritise the next steps", "You receive a written summary of findings and practical recommendations. We distinguish observations from matters requiring a quote, specialist investigation or a formal accredited assessment."],
    ],
    preparation: ["Make a short list of comfort problems and the rooms or times of day affected.", "Have recent energy bills and known appliance or renovation details available if convenient.", "Arrange access to the rooms and accessible equipment you want discussed.", "Tell us whether you need a formal rating for a particular purpose so we can confirm the right service before booking."],
    outcomeTitle: "Written advice without a rating certificate",
    outcome: "This visit provides practical advice and a written record. It does not issue a NatHERS, Home Energy Rating or rental compliance certificate, include licensed gas or electrical testing, or guarantee a reduction in your bills. If you need an accredited existing-home rating or new-home approval documentation, the relevant assessment pathway is available separately.",
    related: ["nathers-existing", "nathers-new", "minimum-rental-standards"],
  },
});
