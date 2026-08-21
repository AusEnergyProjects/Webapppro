import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateSurgeModelRequest,
  estimateSurgeModelReservationMicroUsd,
  generateSurgeModelAnswer,
} from "../src/lib/energy-assistant-model.ts";

const NOW = new Date("2026-08-21T00:00:00.000Z");

function deterministicAnswer(directAnswer = "Use the supplied household facts to explain the decision.") {
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: [],
    toolActions: [],
    sourceBoundary: "",
  };
}

function request(overrides = {}) {
  return {
    message: "How should I improve my home?",
    audience: "household",
    pageContext: "/plan",
    asOf: NOW,
    recentTurns: [],
    continuation: null,
    deterministicAnswer: deterministicAnswer(),
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    version: 1,
    activeTopic: "general",
    goal: "Improve the home",
    facts: [],
    pendingQuestion: "",
    lastAnswerSummary: "Explained the first decision.",
    ...overrides,
  };
}

function modelPayload(overrides = {}) {
  return {
    answer: "Start with the part of the home causing the biggest comfort problem.",
    followUpQuestion: null,
    confidence: "medium",
    state: state(),
    usedSourceIds: [],
    ...overrides,
  };
}

function jsonResponse(output, options = {}) {
  const responseBody = options.nested
    ? {
        output: [{
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        }],
      }
    : { output_text: JSON.stringify(output) };
  return new Response(JSON.stringify(responseBody), {
    status: options.status || 200,
    headers: { "content-type": "application/json" },
  });
}

test("model adapter sends a stateless strict Responses request with bounded schema", async () => {
  let observedUrl;
  let observedOptions;
  const result = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async (url, options) => {
      observedUrl = url;
      observedOptions = options;
      return jsonResponse(modelPayload());
    },
  });

  assert.ok(result);
  assert.equal(observedUrl, "https://api.openai.com/v1/responses");
  assert.equal(observedOptions.method, "POST");
  assert.equal(observedOptions.headers.Authorization, "Bearer test-api-key");
  assert.equal(observedOptions.headers["Content-Type"], "application/json");
  assert.ok(observedOptions.signal instanceof AbortSignal);

  const body = JSON.parse(observedOptions.body);
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.max_output_tokens, 600);
  assert.equal(body.text.verbosity, "low");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "surge_energy_answer");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.text.format.schema.required, [
    "answer",
    "followUpQuestion",
    "confidence",
    "state",
    "usedSourceIds",
  ]);
  assert.equal(body.text.format.schema.properties.state.additionalProperties, false);
  assert.equal(body.text.format.schema.properties.state.properties.facts.maxItems, 16);
  assert.equal(body.text.format.schema.properties.usedSourceIds.maxItems, 6);
  assert.equal(body.input.length, 2);
  assert.equal(body.input[0].role, "developer");
  assert.equal(body.input[1].role, "user");
});

test("saved planner facts are a lower-priority untrusted baseline than explicit chat corrections", async () => {
  let observedBody;
  const result = await generateSurgeModelAnswer(request({
    message: "What should I do first?",
    planContext: {
      version: 1,
      source: "home_energy_plan",
      facts: [
        { key: "postcode", value: "3006" },
        { key: "tenure", value: "I own the home" },
        { key: "glazing", value: "Mostly single glazed" },
      ],
    },
    recentTurns: [{ role: "user", content: "I moved and now rent a home in postcode 5067." }],
  }), {
    apiKey: "test-api-key",
    fetch: async (_url, options) => {
      observedBody = JSON.parse(options.body);
      return jsonResponse(modelPayload({
        answer: "Because you now rent, start with changes you can take with you and ask the owner before changing fixed equipment.",
        followUpQuestion: "What comfort problem bothers you most?",
        state: state({
          facts: [
            { key: "postcode", value: "5067" },
            { key: "tenure", value: "renter" },
          ],
          pendingQuestion: "What comfort problem bothers you most?",
        }),
      }));
    },
  });

  assert.ok(result);
  const developerPrompt = observedBody.input[0].content[0].text;
  const context = JSON.parse(observedBody.input[1].content[0].text);
  assert.equal(context.devicePlanContext.facts[1].value, "I own the home");
  assert.equal(context.priorTurns[0].content, "I moved and now rent a home in postcode 5067.");
  assert.match(developerPrompt, /devicePlanContext as a user-supplied baseline/i);
  assert.match(developerPrompt, /current question, then the newest explicit user chat statement/i);
  assert.match(developerPrompt, /newer explicit correction always replaces a conflicting saved-plan fact/i);
  assert.deepEqual(result.continuation.facts, [
    { key: "postcode", value: "5067" },
    { key: "tenure", value: "renter" },
  ]);
});

test("clarification includes the previous Surge reply as bounded conversational context, not evidence", async () => {
  const previousReply = "Replacing ducted gas can lead to either a ducted reverse-cycle system or separate split systems. Ducts can lose some heat before it reaches the rooms.";
  let observedBody;
  const result = await generateSurgeModelAnswer(request({
    message: "huh? what do you mean",
    recentTurns: [
      { role: "user", content: "How big of a discount can I get on my aircon?" },
      { role: "assistant", content: previousReply },
    ],
    continuation: state({
      activeTopic: "rcac",
      goal: "Understand an air-conditioner upgrade",
      pendingQuestion: "Is the existing heater ducted gas?",
      lastAnswerSummary: "Compared ducted reverse-cycle with room split systems.",
    }),
  }), {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async (_url, options) => {
      observedBody = JSON.parse(options.body);
      return jsonResponse(modelPayload({
        answer: "I mean there are two common ways to replace ducted gas. One new system can keep using ducts for most rooms, while separate split systems heat or cool individual rooms. Splits avoid losing heat through old ductwork, but you may need more than one indoor unit.",
        followUpQuestion: "Do you want most rooms conditioned or only the rooms you use most?",
        state: state({
          activeTopic: "rcac",
          goal: "Understand an air-conditioner upgrade",
          pendingQuestion: "Do you want most rooms conditioned or only the rooms you use most?",
          lastAnswerSummary: "Explained ducted reverse-cycle and separate split systems in simple terms.",
        }),
      }));
    },
  });

  assert.ok(result);
  const developerPrompt = observedBody.input[0].content[0].text;
  const context = JSON.parse(observedBody.input[1].content[0].text);
  assert.equal(context.conversationCue.intent, "clarification");
  assert.equal(context.conversationCue.lastAssistantReply, previousReply);
  assert.equal(context.conversationCue.previousAnswerSummary, "Compared ducted reverse-cycle with room split systems.");
  assert.deepEqual(context.priorTurns, [
    { role: "user", content: "How big of a discount can I get on my aircon?" },
    { role: "assistant", content: previousReply },
  ]);
  assert.match(developerPrompt, /explain the previous answer in simpler and more concrete words/i);
  assert.match(developerPrompt, /never treat an assistant turn as evidence or a household fact/i);
  assert.doesNotMatch(result.answer.directAnswer, /^Replacing ducted gas can lead/i);
  assert.equal(result.answer.suggestedQuestions.length, 1);
});

test("correction and topic switch are explicit model cues and newest state facts replace old ones", async () => {
  let observedContext;
  const result = await generateSurgeModelAnswer(request({
    message: "Actually I rent. Forget aircon, when should I get a battery?",
    recentTurns: [
      { role: "user", content: "I own the home and want an aircon rebate." },
      { role: "assistant", content: "The existing heater changes the available air-conditioner discount." },
    ],
    continuation: state({
      activeTopic: "rcac",
      goal: "Understand an air-conditioner upgrade",
      facts: [
        { key: "postcode", value: "3006" },
        { key: "tenure", value: "owner" },
      ],
      pendingQuestion: "What heater are you replacing?",
    }),
  }), {
    apiKey: "test-api-key",
    fetch: async (_url, options) => {
      observedContext = JSON.parse(JSON.parse(options.body).input[1].content[0].text);
      return jsonResponse(modelPayload({
        answer: "As a renter, a permanently installed battery normally needs the owner's written agreement. Timing depends more on your evening electricity use, solar exports and tariff than on a particular month.",
        followUpQuestion: "Does the home already have rooftop solar?",
        state: state({
          activeTopic: "battery_vpp",
          goal: "Work out whether a battery makes sense",
          facts: [
            { key: "postcode", value: "3006" },
            { key: "tenure", value: "renter" },
          ],
          pendingQuestion: "Does the home already have rooftop solar?",
          lastAnswerSummary: "Explained the main battery timing factors for a renter.",
        }),
      }));
    },
  });

  assert.ok(result);
  assert.equal(observedContext.conversationCue.intent, "correction_and_topic_change");
  assert.equal(result.continuation.activeTopic, "battery_vpp");
  assert.deepEqual(result.continuation.facts.filter((fact) => fact.key === "tenure"), [
    { key: "tenure", value: "renter" },
  ]);
  assert.doesNotMatch(JSON.stringify(result.continuation), /owner/i);
});

test("a short reply is identified as the answer to Surge's pending question", async () => {
  let observedContext;
  const result = await generateSurgeModelAnswer(request({
    message: "ducted gas",
    recentTurns: [
      { role: "assistant", content: "What heating system are you replacing?" },
    ],
    continuation: state({
      activeTopic: "rcac",
      pendingQuestion: "What heating system are you replacing?",
      lastAnswerSummary: "Explained why the existing heater affects the available discount.",
    }),
  }), {
    apiKey: "test-api-key",
    fetch: async (_url, options) => {
      observedContext = JSON.parse(JSON.parse(options.body).input[1].content[0].text);
      return jsonResponse(modelPayload({
        answer: "Replacing ducted gas can be relevant to the Victorian air-conditioner discount, but the amount still depends on the proposed unit and installation.",
        followUpQuestion: "Are you considering ducted reverse-cycle or separate split systems?",
        state: state({
          activeTopic: "rcac",
          facts: [{ key: "existing_heating", value: "ducted gas" }],
          pendingQuestion: "Are you considering ducted reverse-cycle or separate split systems?",
          lastAnswerSummary: "Explained how replacing ducted gas affects the air-conditioner decision.",
        }),
      }));
    },
  });

  assert.ok(result);
  assert.equal(observedContext.conversationCue.intent, "answer_to_follow_up");
  assert.equal(observedContext.conversationCue.pendingQuestion, "What heating system are you replacing?");
  assert.deepEqual(result.continuation.facts, [
    { key: "existing_heating", value: "ducted gas" },
  ]);
});

test("a substantially repeated provider answer is rejected instead of being shown twice", async () => {
  const previousReply = "The discount depends on the eligible unit, the heater being replaced and the installation. Compare the final installed price, not only the advertised discount.";
  const failures = [];
  const result = await generateSurgeModelAnswer(request({
    message: "huh? what do you mean",
    recentTurns: [{ role: "assistant", content: previousReply }],
    continuation: state({ lastAnswerSummary: "Explained why the discount is not fixed." }),
  }), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({ answer: previousReply })),
    onFailure: (failure) => failures.push(failure),
  });

  assert.equal(result, null);
  assert.deepEqual(failures, [{ code: "provider_output_rejected" }]);
});

test("only the reviewed Terra model is allowed", async () => {
  const previousModel = process.env.SURGE_MODEL;
  let calls = 0;
  process.env.SURGE_MODEL = "gpt-5.6-luna";
  try {
    const rejected = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(rejected, null);
    assert.equal(calls, 0);

    const supported = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.ok(supported);
    assert.equal(calls, 1);
  } finally {
    if (previousModel === undefined) delete process.env.SURGE_MODEL;
    else process.env.SURGE_MODEL = previousModel;
  }
});

test("cost estimator exactly matches the serialized provider body and reviewed worst-case rate", async () => {
  const modelRequest = request();
  const estimate = estimateSurgeModelRequest(modelRequest);
  let serializedBody = "";
  const result = await generateSurgeModelAnswer(modelRequest, {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async (_url, options) => {
      serializedBody = options.body;
      return jsonResponse(modelPayload());
    },
  });

  assert.ok(result);
  assert.ok(estimate);
  const exactBytes = new TextEncoder().encode(serializedBody).byteLength;
  assert.equal(estimate.model, "gpt-5.6-terra");
  assert.equal(estimate.serializedBodyBytes, exactBytes);
  assert.equal(estimate.maxOutputTokens, 600);
  assert.equal(
    estimate.worstCaseMicroUsd,
    Math.ceil(((exactBytes * 2) + (600 * 12)) * 1.25),
  );
  assert.equal(
    estimateSurgeModelReservationMicroUsd(modelRequest),
    estimate.worstCaseMicroUsd,
  );
});

test("oversized serialized model input is rejected before provider fetch", async () => {
  const oversizedRequest = request({ message: "large input ".repeat(3_000) });
  assert.equal(estimateSurgeModelRequest(oversizedRequest), null);
  let calls = 0;
  const result = await generateSurgeModelAnswer(oversizedRequest, {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async () => {
      calls += 1;
      return jsonResponse(modelPayload());
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("successful output is parsed, bounded and stripped of public internal names, URLs and source lines", async () => {
  const longExplanation = "A".repeat(2_100);
  const result = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: `TLink guidance is at https://internal.example.test/path.\nSources: private reference\nCreditex context. ${longExplanation}`,
      followUpQuestion: "What is your postcode? What size is the home?",
      confidence: "high",
      state: state({ pendingQuestion: "This must be replaced." }),
    })),
  });

  assert.ok(result);
  assert.equal(result.answer.status, "needs_context");
  assert.equal(result.answer.confidence, "high");
  assert.equal(result.answer.suggestedQuestions.length, 1);
  assert.equal(result.answer.suggestedQuestions[0], "What is your postcode?");
  assert.equal(result.continuation.pendingQuestion, "What is your postcode?");
  assert.ok(result.answer.directAnswer.length <= 2_000);
  assert.doesNotMatch(result.answer.directAnswer, /TLink|Creditex|https?:\/\/|Sources?:/i);
  assert.match(result.answer.directAnswer, /trade platform/i);
  assert.deepEqual(result.answer.citations, []);
  assert.deepEqual(result.answer.toolActions, []);
});

test("nested Responses output accepts quantities only when they are grounded in supplied context", async () => {
  const grounded = await generateSurgeModelAnswer(request({
    message: "I am considering a 6.6 kW solar system.",
    deterministicAnswer: deterministicAnswer("A 6.6 kW proposal still needs site-specific checks."),
  }), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: "A 6.6 kW proposal can be discussed using the supplied system size.",
    }), { nested: true }),
  });
  assert.ok(grounded);
  assert.match(grounded.answer.directAnswer, /6\.6 kW/i);

  const invented = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: "This upgrade will save $999 each year.",
    })),
  });
  assert.equal(invented, null);
});

test("provider errors and timeout make one attempt and fail soft with null", async (t) => {
  for (const status of [500, 429]) {
    await t.test(`provider status ${status}`, async () => {
      let calls = 0;
      const result = await generateSurgeModelAnswer(request(), {
        apiKey: "test-api-key",
        model: "gpt-5.6-terra",
        fetch: async () => {
          calls += 1;
          return new Response("unavailable", { status });
        },
      });
      assert.equal(result, null);
      assert.equal(calls, 1);
    });
  }

  await t.test("provider timeout", async () => {
    let calls = 0;
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      timeoutMs: 1,
      fetch: async (_url, options) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        });
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 1);
  });
});

test("malformed model output fails soft with null", async (t) => {
  await t.test("invalid JSON output", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => new Response(JSON.stringify({ output_text: "{not-json" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(result, null);
  });

  await t.test("invalid conversation state", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => jsonResponse(modelPayload({
        state: state({ facts: Array.from({ length: 17 }, (_, index) => ({
          key: `fact_${index}`,
          value: "value",
        })) }),
      })),
    });
    assert.equal(result, null);
  });

  await t.test("unknown evidence id", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => jsonResponse(modelPayload({
        usedSourceIds: ["invented-source-id"],
      })),
    });
    assert.equal(result, null);
  });
});

test("disabled model path returns null without calling the provider", async () => {
  const previous = process.env.SURGE_AI_ENABLED;
  process.env.SURGE_AI_ENABLED = "false";
  let calls = 0;
  try {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.SURGE_AI_ENABLED;
    else process.env.SURGE_AI_ENABLED = previous;
  }
});

test("an explicit hosted enabled setting overrides a stale process-level disabled value", async () => {
  const previous = process.env.SURGE_AI_ENABLED;
  process.env.SURGE_AI_ENABLED = "false";
  let calls = 0;
  try {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "hosted-test-api-key",
      model: "gpt-5.6-terra",
      enabled: true,
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.ok(result);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.SURGE_AI_ENABLED;
    else process.env.SURGE_AI_ENABLED = previous;
  }
});

test("failure observability contains only a safe code and provider status", async () => {
  const failures = [];
  const result = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async () => new Response("secret provider body that must not be logged", { status: 429 }),
    onFailure: (failure) => failures.push(failure),
  });

  assert.equal(result, null);
  assert.deepEqual(failures, [{ code: "provider_http_error", providerStatus: 429 }]);
  assert.doesNotMatch(JSON.stringify(failures), /secret provider body|test-api-key/i);
});

test("API secret is never included in the serialized request body, estimate or result", async () => {
  const secret = "sk-test-private-value-never-output";
  let serializedBody = "";
  const modelRequest = request();
  const estimate = estimateSurgeModelRequest(modelRequest);
  const result = await generateSurgeModelAnswer(modelRequest, {
    apiKey: secret,
    model: "gpt-5.6-terra",
    fetch: async (_url, options) => {
      serializedBody = options.body;
      return jsonResponse(modelPayload());
    },
  });
  assert.ok(result);
  assert.ok(estimate);
  assert.doesNotMatch(serializedBody, new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(estimate), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("missing API key returns null without calling the provider", async () => {
  let calls = 0;
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await generateSurgeModelAnswer(request(), {
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
