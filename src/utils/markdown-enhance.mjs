const calloutLabels = {
  note: "NOTE",
  tip: "TIP",
  important: "IMPORTANT",
  warning: "WARNING",
  caution: "CAUTION"
};

function visit(node, callback) {
  if (!node || typeof node !== "object") {
    return;
  }

  callback(node);

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => visit(child, callback));
  }
}

function getText(node) {
  if (!node || typeof node !== "object") {
    return "";
  }

  if (node.type === "text") {
    return node.value ?? "";
  }

  if (!Array.isArray(node.children)) {
    return "";
  }

  return node.children.map(getText).join("");
}

function removeCalloutMarker(paragraph, type) {
  const marker = `[!${type.toUpperCase()}]`;

  if (!Array.isArray(paragraph.children)) {
    return;
  }

  for (const child of paragraph.children) {
    if (child.type !== "text" || typeof child.value !== "string") {
      continue;
    }

    const index = child.value.indexOf(marker);
    if (index === -1) {
      continue;
    }

    child.value = `${child.value.slice(0, index)}${child.value.slice(index + marker.length)}`.replace(/^\s*\n?/, "");
    break;
  }

  paragraph.children = paragraph.children.filter((child) => child.type !== "text" || child.value.length > 0);
}

export default function markdownEnhance() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== "element") {
        return;
      }

      if (node.tagName === "blockquote") {
        const firstParagraph = Array.isArray(node.children)
          ? node.children.find((child) => child.type === "element" && child.tagName === "p")
          : null;
        const markerMatch = getText(firstParagraph).match(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);

        if (firstParagraph && markerMatch) {
          const type = markerMatch[1].toLowerCase();
          removeCalloutMarker(firstParagraph, type);
          node.properties = {
            ...(node.properties ?? {}),
            className: ["callout", `callout-${type}`],
            dataCalloutLabel: calloutLabels[type]
          };
        }
      }

      if (node.tagName === "pre" && Array.isArray(node.children)) {
        const code = node.children.find((child) => child.type === "element" && child.tagName === "code");
        const classNames = code?.properties?.className;
        const languageClass = Array.isArray(classNames)
          ? classNames.find((className) => String(className).startsWith("language-"))
          : null;

        if (languageClass) {
          const language = String(languageClass).replace("language-", "");
          node.properties = {
            ...(node.properties ?? {}),
            dataLanguage: language
          };
        }
      }
    });
  };
}
