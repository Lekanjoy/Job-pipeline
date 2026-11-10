function fillApplicationFields(kit) {
  const normalize = (value) =>
    String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const entries = (items) =>
    (Array.isArray(items) ? items : []).filter(
      (item) =>
        typeof item?.label === "string" &&
        typeof item?.value === "string" &&
        item.value.trim(),
    );
  const profile = entries(kit?.profile);
  const answers = entries(kit?.answers);
  const fullName = profile.find((item) =>
    /^(full name|name|legal name)$/.test(normalize(item.label)),
  )?.value.trim();
  const nameParts = fullName ? fullName.split(/\s+/) : [];
  const profileAliases = [
    { key: "email", cues: ["email", "e mail"] },
    { key: "phone", cues: ["phone", "mobile", "telephone"] },
    { key: "linked in", cues: ["linkedin", "linked in"] },
    { key: "git hub", cues: ["github", "git hub"] },
    {
      key: "portfolio",
      cues: ["portfolio", "personal website", "personal site"],
    },
  ];
  const answerAliases = [
    {
      cues: ["work authorization", "authorized to work", "visa sponsorship"],
      label: "work authorization how you work",
    },
    {
      cues: ["salary expectation", "expected salary", "salary requirements"],
      label: "salary expectation",
    },
    {
      cues: ["availability", "start date", "notice period"],
      label: "availability start date",
    },
    {
      cues: ["years of experience", "years experience"],
      label: "years of experience",
    },
    {
      cues: ["current role", "current position"],
      label: "current role",
    },
    {
      cues: ["tech stack", "technical skills", "technologies"],
      label: "tech stack",
    },
    {
      cues: ["fintech experience"],
      label: "fintech experience",
    },
    {
      cues: ["role based access", "dashboards"],
      label: "dashboards and role based access",
    },
    {
      cues: ["stakeholders", "working with stakeholders"],
      label: "working with stakeholders",
    },
    {
      cues: ["project you are proud", "proud of"],
      label: "a project you re proud of",
    },
    {
      cues: ["where are you based", "country of residence"],
      label: "where are you based",
    },
  ];

  function fieldText(field) {
    const parts = [];
    if (field.labels) {
      for (const label of field.labels) parts.push(label.textContent);
    }
    const wrappingLabel = field.closest("label");
    if (wrappingLabel) parts.push(wrappingLabel.textContent);
    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        parts.push(document.getElementById(id)?.textContent);
      }
    }
    for (const attr of [
      "aria-label",
      "placeholder",
      "name",
      "id",
      "autocomplete",
      "data-testid",
    ]) {
      parts.push(field.getAttribute(attr));
    }
    if (field.parentElement) {
      parts.push(field.parentElement.getAttribute("data-automation-id"));
    }
    return normalize(parts.filter(Boolean).join(" "));
  }

  function valueFor(field, text) {
    const tag = field.tagName;
    const type = normalize(field.type || "");
    if (
      field.disabled ||
      field.readOnly ||
      field.isContentEditable ||
      !["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
      (tag === "INPUT" &&
        !["", "email", "search", "tel", "text", "url"].includes(type))
    ) {
      return null;
    }

    if (/\b(first|given) name\b/.test(text)) {
      const value = nameParts[0];
      if (value) return value;
    }
    if (/\b(last|family|surname)\b/.test(text) && /\bname\b/.test(text)) {
      const value = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
      if (value) return value;
    }

    for (const item of profile) {
      const key = normalize(item.label);
      const value = item.value.trim();
      const aliases = profileAliases.find((entry) => entry.key === key);
      if (aliases?.cues.some((cue) => text.includes(normalize(cue)))) {
        return value;
      }
      if (
        (key === "email" &&
          (type === "email" || /\b(email|e mail)\b/.test(text))) ||
        (key === "phone" &&
          (type === "tel" || /\b(phone|mobile|telephone)\b/.test(text))) ||
        (key === "portfolio" &&
          /\b(portfolio|website|personal site)\b/.test(text)) ||
        (/^(full name|name|legal name)$/.test(key) &&
          (/^(name|full name|legal name|your name)$/.test(text) ||
            /\b(full name|legal name|your name)\b/.test(text)) &&
          tag !== "SELECT")
      ) {
        return value;
      }

      if (key && text.includes(key)) return value;
    }

    for (const alias of answerAliases) {
      if (!alias.cues.some((cue) => text.includes(normalize(cue)))) continue;
      const answer = answers.find(
        (item) => normalize(item.label) === normalize(alias.label),
      );
      if (answer) return answer.value.trim();
    }

    const exactAnswer = answers.find((item) => {
      const label = normalize(item.label);
      return label && (text === label || text.includes(label));
    });
    return exactAnswer?.value.trim() || null;
  }

  let filled = 0;
  const unmatched = [];
  const fields = document.querySelectorAll("input, textarea, select");
  for (const field of fields) {
    if (
      !field.getClientRects().length ||
      window.getComputedStyle(field).visibility === "hidden" ||
      window.getComputedStyle(field).display === "none"
    ) {
      continue;
    }
    if (field.value && field.value.trim()) continue;

    const text = fieldText(field);
    const value = valueFor(field, text);
    if (!value) continue;

    let matchedValue = value;
    if (field.tagName === "SELECT") {
      const option = Array.from(field.options).find(
        (item) =>
          normalize(item.value) === normalize(value) ||
          normalize(item.textContent) === normalize(value),
      );
      if (!option) {
        unmatched.push(text);
        continue;
      }
      matchedValue = option.value;
    }

    const prototype =
      field.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : field.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(field, matchedValue);
    else field.value = matchedValue;

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  }

  return { filled, unmatched };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { fillApplicationFields };
}
