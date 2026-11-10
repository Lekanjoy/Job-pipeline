import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { fillApplicationFields } = require("../browser-extension/fill.js");

function makeField(tagName, type, label, value = "") {
  const field = {};
  field.tagName = tagName;
  field.type = type;
  field.labels = [{ textContent: label }];
  field.attributes = {};
  field.disabled = false;
  field.readOnly = false;
  field.isContentEditable = false;
  field.events = [];
  field._value = value;
  field.parentElement = {
    getAttribute: () => null,
  };
  field.closest = () => null;
  Object.defineProperty(field, "value", {
    get() {
      return this._value;
    },
    set(nextValue) {
      this._value = nextValue;
    },
  });
  field.getAttribute = (name) => field.attributes[name] || null;
  field.getClientRects = () => [{}];
  field.dispatchEvent = (event) => field.events.push(event.type);
  return field;
}

function setBrowserGlobals(fields) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Event: globalThis.Event,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    HTMLSelectElement: globalThis.HTMLSelectElement,
  };
  class InputElement {}
  class TextAreaElement {}
  class SelectElement {}
  for (const Element of [InputElement, TextAreaElement, SelectElement]) {
    Object.defineProperty(Element.prototype, "value", {
      get() {
        return this._value;
      },
      set(value) {
        this._value = value;
      },
    });
  }
  globalThis.HTMLInputElement = InputElement;
  globalThis.HTMLTextAreaElement = TextAreaElement;
  globalThis.HTMLSelectElement = SelectElement;
  globalThis.Event = class {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.document = {
    querySelectorAll: () => fields,
    getElementById: () => null,
  };
  globalThis.window = {
    getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  };

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
}

test("fills confidently matched empty fields and leaves other fields alone", () => {
  const fields = [
    makeField("INPUT", "text", "First Name"),
    makeField("INPUT", "text", "Last Name"),
    makeField("INPUT", "email", "Email address"),
    makeField("INPUT", "url", "LinkedIn profile"),
    makeField("TEXTAREA", "textarea", "How many years of experience do you have?"),
    makeField("INPUT", "text", "Current company", "Existing value"),
    makeField("INPUT", "password", "Password"),
    makeField("INPUT", "number", "Salary expectation"),
  ];
  const restore = setBrowserGlobals(fields);

  try {
    const result = fillApplicationFields({
      profile: [
        { label: "Full name", value: "Ada Lovelace" },
        { label: "Email", value: "ada@example.com" },
        { label: "LinkedIn", value: "https://linkedin.com/in/ada" },
      ],
      answers: [
        { label: "Years of experience", value: "Several years." },
      ],
    });

    assert.deepEqual(result, { filled: 5, unmatched: [] });
    assert.deepEqual(
      fields.slice(0, 5).map((field) => field.value),
      [
        "Ada",
        "Lovelace",
        "ada@example.com",
        "https://linkedin.com/in/ada",
        "Several years.",
      ],
    );
    assert.equal(fields[5].value, "Existing value");
    assert.equal(fields[6].value, "");
    assert.equal(fields[7].value, "");
    assert.equal(fields.every((field) => !field.events.includes("submit")), true);
  } finally {
    restore();
  }
});

test("matches profile fields using input names, autocomplete and accessible labels", () => {
  const github = makeField("INPUT", "url", "");
  github.attributes.name = "candidate_github_url";
  const linkedIn = makeField("INPUT", "url", "");
  linkedIn.attributes["aria-labelledby"] = "linkedin-label";
  const firstName = makeField("INPUT", "text", "");
  firstName.attributes.autocomplete = "given-name";
  const fullName = makeField("INPUT", "text", "");
  fullName.attributes.autocomplete = "name";
  const fields = [github, linkedIn, firstName, fullName];
  const restore = setBrowserGlobals(fields);
  globalThis.document.getElementById = (id) =>
    id === "linkedin-label" ? { textContent: "LinkedIn profile URL" } : null;

  try {
    const result = fillApplicationFields({
      profile: [
        { label: "Full name", value: "Ada Lovelace" },
        { label: "LinkedIn", value: "https://linkedin.com/in/ada" },
        { label: "GitHub", value: "https://github.com/ada" },
      ],
      answers: [],
    });

    assert.deepEqual(
      result,
      { filled: 4, unmatched: [] },
      JSON.stringify(fields.map((field) => field.value)),
    );
    assert.equal(github.value, "https://github.com/ada");
    assert.equal(linkedIn.value, "https://linkedin.com/in/ada");
    assert.equal(firstName.value, "Ada");
    assert.equal(fullName.value, "Ada Lovelace");
  } finally {
    restore();
  }
});

test("fills a select only when an option exactly matches the saved answer", () => {
  const exact = makeField("SELECT", "select-one", "Where are you based?");
  exact.options = [
    { value: "", textContent: "Choose a country" },
    { value: "Nigeria", textContent: "Nigeria" },
  ];
  const unmatched = makeField("SELECT", "select-one", "Salary expectation");
  unmatched.options = [
    { value: "", textContent: "Choose one" },
    { value: "2500", textContent: "$2,500" },
  ];
  const restore = setBrowserGlobals([exact, unmatched]);

  try {
    const result = fillApplicationFields({
      profile: [],
      answers: [
        { label: "Where are you based?", value: "Nigeria" },
        { label: "Salary expectation", value: "$2500/month." },
      ],
    });

    assert.deepEqual(result, { filled: 1, unmatched: ["salary expectation"] });
    assert.equal(exact.value, "Nigeria");
    assert.equal(unmatched.value, "");
  } finally {
    restore();
  }
});
