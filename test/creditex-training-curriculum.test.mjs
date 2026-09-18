import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GOVERNMENT_ACTIVITY_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";
import { TRAINING_MODULES, creditexTrainingModuleForActivity, CREDITEX_TRAINING_DISCLAIMER } from "../src/data/creditex-training-curriculum.ts";

const expectedIds = GOVERNMENT_ACTIVITY_TEMPLATES.map((activity) => activity.templateId);
const correctText = (question) => question.options.find((option) => option.id === question.correctOptionId)?.text;
const moduleById = (id) => {
  const trainingCourse = TRAINING_MODULES.find((entry) => entry.id === id);
  assert.ok(trainingCourse, `Missing trainingCourse ${id}`);
  return trainingCourse;
};

test("every catalogue activity has its own exact programme-bound course with automatic publication only for complete sources", () => {
  assert.deepEqual(TRAINING_MODULES.map((trainingCourse) => trainingCourse.id).sort(), [...expectedIds].sort());
  const catalogueIds = new Set(GOVERNMENT_ACTIVITY_TEMPLATES.map((activity) => activity.templateId));
  for (const trainingCourse of TRAINING_MODULES) {
    assert.equal(trainingCourse.reviewStatus, trainingCourse.sourceCoverage.status === "source_transcribed" ? "published" : "incomplete");
    assert.ok(trainingCourse.scope.length > 50);
    assert.deepEqual(trainingCourse.activityTemplateIds, [trainingCourse.id]);
    assert.ok(catalogueIds.has(trainingCourse.id));
    assert.equal(trainingCourse.programCode, GOVERNMENT_ACTIVITY_TEMPLATES.find((activity) => activity.templateId === trainingCourse.id).programCode);
    assert.equal(creditexTrainingModuleForActivity(trainingCourse.id), trainingCourse);
  }
  for (const value of ["", "unknown", "VEU-6", "veu-6-extra", "veu-12"]) {
    assert.equal(creditexTrainingModuleForActivity(value), null);
  }
});

test("each course has 25 answerable questions, individual explanations, critical gates and complete source bindings", () => {
  const allIds = new Set();
  for (const trainingCourse of TRAINING_MODULES) {
    assert.equal(trainingCourse.questions.length, 25);
    assert.ok(trainingCourse.estimatedMinutes >= 20 && trainingCourse.estimatedMinutes <= 30);
    assert.equal(trainingCourse.passPercent, 100);
    assert.ok(trainingCourse.validityDays > 0);
    assert.equal(trainingCourse.retakeCooldownMinutes, 0);
    assert.ok(trainingCourse.lessons.length >= 6);
    assert.ok(trainingCourse.lessons.reduce((words, lesson) => words + lesson.body.split(/\s+/).length, 0) >= 450);
    const sources = new Map(trainingCourse.sources.map((source) => [source.id, source]));
    assert.equal(sources.size, trainingCourse.sources.length);
    assert.ok(trainingCourse.sources.some((source) => source.url.startsWith("https://")));
    assert.ok(trainingCourse.questions.filter((question) => question.critical).length >= 10);
    assert.equal(new Set(trainingCourse.questions.map((question) => question.prompt)).size, 25);
    assert.equal(new Set(trainingCourse.questions.map((question) => question.correctOptionId)).size, 4);
    for (const item of [...trainingCourse.lessons, ...trainingCourse.questions]) {
      assert.ok(item.sourceIds.length > 0);
      for (const id of item.sourceIds) assert.ok(sources.has(id), `${trainingCourse.id} missing source ${id}`);
    }
    for (const question of trainingCourse.questions) {
      assert.ok(!allIds.has(question.id));
      allIds.add(question.id);
      assert.equal(question.options.length, 4);
      assert.equal(new Set(question.options.map((option) => option.id)).size, 4);
      assert.equal(new Set(question.options.map((option) => option.text)).size, 4);
      assert.equal(question.options.filter((option) => option.id === question.correctOptionId).length, 1);
      assert.ok(question.explanation.length > 45);
      assert.ok(question.prompt.length > 25);
    }
  }
  assert.equal(allIds.size, expectedIds.length * 25);
});

test("source conflicts are explicit and cannot be represented as fully transcribed", () => {
  for (const trainingCourse of TRAINING_MODULES) {
    assert.equal(trainingCourse.sourceCoverage.status === "partial", trainingCourse.sourceCoverage.gaps.length > 0);
  }
  for (const id of ["act-eeis-1-9", "act-eeis-2-4", "act-eeis-4-1", "act-eeis-5-4", "act-eeis-5-6", "sa-reps-tou1", "sa-reps-vpp1", "wa-battery-rewards-activation-event"]) {
    assert.equal(moduleById(id).sourceCoverage.status, "partial", id);
  }
});

test("current NSW loans are distinct from unavailable discounts and remain subject to lender approval", () => {
  const hesCourses = TRAINING_MODULES.filter((entry) => entry.programCode === "NSW-HES");
  assert.equal(hesCourses.length, 12);
  for (const trainingCourse of hesCourses) {
    assert.match(trainingCourse.title, /\(loan only\)$/);
    assert.match(trainingCourse.scope, /current loan-only pathway/);
    assert.equal(trainingCourse.sourceCoverage.status, "source_transcribed");
    const lessonText = trainingCourse.lessons.map((lesson) => lesson.body).join(" ");
    assert.match(lessonText, /open Home Energy Saver loans delivered by Brighte and Plenti/);
    assert.match(lessonText, /does not authorise a discount booking or claim/);
    assert.match(lessonText, /finance provider assesses eligibility and repayment ability/);
    assert.ok(trainingCourse.questions.some((question) => correctText(question)?.includes("does not authorise a discount booking or claim") && question.critical));
  }
});

test("SA secondary glazing uses the gazetted 2026 specification while unresolved current activities stay blocked", () => {
  const glazing = moduleById("sa-reps-bs3b");
  assert.equal(glazing.sourceCoverage.status, "source_transcribed");
  const source = glazing.sources.find((entry) => entry.id === "sa-bs3b-spec");
  assert.equal(source?.url, "https://www.governmentgazette.sa.gov.au/2026/February/2026_008.pdf");
  assert.match(source.citation, /302–304/);
  const text = glazing.lessons.map((lesson) => lesson.body).join(" ");
  assert.match(text, /BS3B\.2026\.1 replaces the 2024 notice/);
  assert.match(text, /transition factor 4 for priority households and 1 for non-priority customers/);
  for (const id of ["sa-reps-bs3b", "sa-reps-tou1", "sa-reps-vpp1"]) {
    assert.equal(GOVERNMENT_ACTIVITY_TEMPLATES.find((entry) => entry.templateId === id).catalogueState, "current");
  }
});

test("current and future dates remain distinct across programme-specific modules", () => {
  const text = (id) => moduleById(id).lessons.map((lesson) => lesson.body).join(" ");
  assert.match(text("veu-pba-mv"), /Version 8 applies before 1 October 2026; version 9 commences on that date/);
  assert.match(text("veu-45"), /closed on 23 June 2026/);
  assert.match(text("nsw-ess-d6"), /Gazette commencement/);
  assert.match(text("nsw-ess-d11"), /expired at the end of 30 June 2026/);
  assert.match(text("nsw-pdrs-bess3"), /Class 2 apartment building with at least four dwellings/);
  assert.match(text("nsw-pdrs-bess4"), /\$5,000 excluding GST/);
  assert.match(text("nsw-pdrs-bess5"), /UL9540A/);
  assert.match(text("nsw-pdrs-wh1"), /removed from the PDRS from 1 July 2026/);
  assert.match(text("solar-vic-apt-pv-apartment"), /15 September 2026|September 2026/);
});

test("technical question alternatives stay inside the exact activity profile", () => {
  for (const trainingCourse of TRAINING_MODULES) {
    const lessons = trainingCourse.lessons.map((lesson) => lesson.body).join(" ");
    for (const question of trainingCourse.questions.filter((question) => question.prompt.includes("which rule specifically addresses"))) {
      for (const option of question.options) assert.ok(lessons.includes(option.text), `${question.id}: unrelated alternative`);
    }
  }
});

test("NSW technical instruction uses exact equipment and statutory distinctions, beyond nomination labels", () => {
  const text = (id) => moduleById(id).lessons.map((lesson) => lesson.body).join(" ");
  assert.match(text("nsw-ess-c1"), /one fewer spare refrigerator/);
  assert.match(text("nsw-ess-c2"), /removed primary fridge\/freezer must be working/);
  assert.match(text("nsw-ess-d1"), /six heating stars and 3.5 cooling stars/);
  assert.match(text("nsw-ess-d2"), /still-air gap/);
  assert.match(text("nsw-ess-e1"), /462 lumens/);
  assert.match(text("nsw-ess-e9"), /chimney balloons are excluded/);
  assert.match(text("nsw-ess-f7"), /0.73 kW and less than 185 kW/);
  assert.match(text("nsw-ess-f12"), /80% of boiler operating time/);
  assert.match(text("nsw-ess-f16"), /gas-boosted new heat pump must replace a gas baseline/);
  assert.match(text("nsw-ess-f17"), /0.7 confidence factor from 1 January 2027/);
  for (const id of ["nsw-ess-c1", "nsw-ess-d1", "nsw-ess-e1", "nsw-ess-f7", "nsw-ess-f12", "nsw-ess-f16"]) {
    assert.ok(moduleById(id).questions.filter((question) => question.sourceIds.some((sourceId) => sourceId.endsWith("-technical"))).length >= 6, id);
  }
});

test("Activity 6 teaches both sides of the September 30 co-payment boundary without HWS procedures", () => {
  const trainingCourse = moduleById("veu-6");
  const before = trainingCourse.questions.find((question) => question.prompt.includes("29 September 2026"));
  const after = trainingCourse.questions.find((question) => question.prompt.includes("ducted system is installed on 30 September"));
  const multiLarge = trainingCourse.questions.find((question) => question.prompt.includes("12 kW rated-cooling multi-split"));
  const multiSmall = trainingCourse.questions.find((question) => question.prompt.includes("8 kW rated-cooling multi-split"));
  const single = trainingCourse.questions.find((question) => question.prompt.includes("7 kW single-split"));
  assert.ok(before && after && multiLarge && multiSmall && single);
  assert.match(correctText(before), /\$1,000/);
  assert.match(correctText(after), /\$3,000/);
  assert.match(correctText(multiLarge), /\$3,000/);
  assert.match(correctText(multiSmall), /\$1,000/);
  assert.match(correctText(single), /\$200/);
  const copiedProcedure = trainingCourse.questions.find((question) => question.prompt.includes("copy error"));
  assert.ok(copiedProcedure?.critical);
  assert.match(correctText(copiedProcedure), /hot-water tank/);
});

test("water-heating modules distinguish fuel baseline, installer scope and premises-specific assignments", () => {
  assert.match(correctText(moduleById("veu-1").questions[0]), /electric-resistance/);
  assert.match(correctText(moduleById("veu-3").questions[0]), /gas\/LPG/);
  for (const id of ["veu-1", "veu-3"]) {
    const trainingCourse = moduleById(id);
    assert.ok(trainingCourse.questions.some((question) => /non-residential|business site/.test(question.prompt) && question.critical));
    assert.ok(trainingCourse.questions.some((question) => /licen|qualified/.test(question.prompt) && question.critical));
    assert.ok(trainingCourse.questions.some((question) => /STC/.test(question.prompt) && question.critical));
  }
});

test("insulation requires each installer's external certification and safe pre-installation sequence", () => {
  const trainingCourse = moduleById("veu-48");
  const text = trainingCourse.lessons.map((lesson) => lesson.body).join(" ");
  for (const pattern of [/Every onsite installer/, /full EEC Certified/, /registered with the ESC/, /contract between the AP and consumer/, /24 hours/, /30 days/, /no more than five days/, /five-year/]) assert.match(text, pattern);
  assert.ok(trainingCourse.questions.some((question) => question.prompt.includes("replace in the EEC") && correctText(question).startsWith("Nothing")));
  assert.ok(trainingCourse.questions.some((question) => question.prompt.includes("only available assignment") && correctText(question).startsWith("No;")));
});

test("STC technologies have distinct capacity and evidence scenarios and no PV deeming shortcut", () => {
  const hp = moduleById("sres-ashp");
  const solar = moduleById("sres-swh");
  const capacity = hp.questions.find((question) => question.prompt.includes("over 425 litres"));
  assert.ok(capacity?.critical);
  assert.match(correctText(capacity), /^No/);
  const largeSolar = solar.questions.find((question) => question.prompt.includes("exceeds 700 litres"));
  assert.ok(largeSolar?.critical);
  assert.match(correctText(largeSolar), /Additional documentation/);
  assert.ok(solar.questions.some((question) => question.prompt.includes("2016/2017") && question.critical));
  for (const trainingCourse of [hp, solar]) {
    assert.ok(trainingCourse.questions.some((question) => /deadline|By when/.test(question.prompt) && /12 months/.test(correctText(question))));
    assert.ok(trainingCourse.lessons.some((lesson) => lesson.body.includes("five years")));
  }
  assert.match(CREDITEX_TRAINING_DISCLAIMER, /does not grant a trade licence/);
  const largeSolarDocuments = solar.questions.find((question) => question.prompt.includes("Which additional records"));
  assert.match(correctText(largeSolarDocuments), /system-owner statutory declaration and a system-size statutory declaration/);
});

test("every local resource resolves and only reviewed consumer materials are public PDFs", () => {
  const localSources = new Set(TRAINING_MODULES.flatMap((trainingCourse) => trainingCourse.sources.map((source) => source.url)).filter((url) => url.startsWith("/")));
  for (const source of localSources) {
    const file = fileURLToPath(new URL(`../public${source}`, import.meta.url));
    assert.ok(existsSync(file), `Missing source resource ${source}`);
  }
  const review = readFileSync(new URL("../docs/creditex-training-source-review.md", import.meta.url), "utf8");
  for (const id of expectedIds) assert.ok(review.includes(id));
  assert.match(review, /105 513 040/);
  assert.match(review, /30 September 2026/);
  assert.match(review, /SHA-256/);
  assert.match(review, /not captured/);
});
