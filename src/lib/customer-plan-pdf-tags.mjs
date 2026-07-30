import {
  beginMarkedContent,
  endMarkedContent,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
} from "pdf-lib";

const STRUCTURE_ROLES = new Set([
  "Document",
  "Sect",
  "H1",
  "H2",
  "H3",
  "P",
  "Link",
  "Figure",
  "Span",
]);

function structureRole(value) {
  const supplied = String(value || "");
  if (!STRUCTURE_ROLES.has(supplied)) {
    throw new TypeError(`Unsupported PDF structure role: ${supplied}`);
  }
  return supplied;
}

function optionalText(value, maximum = 1_000) {
  return Array.from(String(value || "").trim()).slice(0, maximum).join("");
}

export function createCustomerPlanPdfTagger(pdf) {
  const context = pdf.context;
  const root = PDFDict.withContext(context);
  const rootRef = context.register(root);
  const documentKids = PDFArray.withContext(context);
  const documentElement = context.obj({
    Type: PDFName.of("StructElem"),
    S: PDFName.of("Document"),
    P: rootRef,
    K: documentKids,
  });
  const documentRef = context.register(documentElement);
  const rootKids = PDFArray.withContext(context);
  rootKids.push(documentRef);

  root.set(PDFName.of("Type"), PDFName.of("StructTreeRoot"));
  root.set(PDFName.of("K"), rootKids);
  pdf.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  pdf.catalog.set(
    PDFName.of("MarkInfo"),
    context.obj({ Marked: PDFBool.True }),
  );

  const pageStates = new Map();
  const parentTreeEntries = new Map();
  let currentSection = null;
  let nextParentKey = 0;
  let finalized = false;

  function assertOpen() {
    if (finalized) {
      throw new Error("The customer plan PDF tag tree is already finalised.");
    }
  }

  function pageState(page) {
    const state = pageStates.get(page);
    if (!state) {
      throw new Error("Register the PDF page before adding tagged content.");
    }
    return state;
  }

  function registerPage(page) {
    assertOpen();
    if (pageStates.has(page)) return pageStates.get(page);
    const parentKey = nextParentKey;
    nextParentKey += 1;
    const state = {
      parentKey,
      nextMcid: 0,
      parents: [],
    };
    pageStates.set(page, state);
    page.node.set(PDFName.of("StructParents"), PDFNumber.of(parentKey));
    page.node.set(PDFName.of("Tabs"), PDFName.of("S"));
    return state;
  }

  function beginSection(title = "") {
    assertOpen();
    const kids = PDFArray.withContext(context);
    const section = context.obj({
      Type: PDFName.of("StructElem"),
      S: PDFName.of("Sect"),
      P: documentRef,
      K: kids,
    });
    const safeTitle = optionalText(title, 180);
    if (safeTitle) {
      section.set(PDFName.of("T"), PDFHexString.fromText(safeTitle));
    }
    const ref = context.register(section);
    documentKids.push(ref);
    currentSection = { ref, kids };
    return currentSection;
  }

  function mark(page, role, draw, {
    actualText = "",
    alt = "",
    parent = currentSection,
  } = {}) {
    assertOpen();
    const safeRole = structureRole(role);
    const state = pageState(page);
    const mcid = state.nextMcid;
    state.nextMcid += 1;
    const properties = context.obj({ MCID: PDFNumber.of(mcid) });
    page.pushOperators(PDFOperator.of(
      PDFOperatorNames.BeginMarkedContentSequence,
      [PDFName.of(safeRole), properties],
    ));
    try {
      draw();
    } finally {
      page.pushOperators(endMarkedContent());
    }

    const parentRef = parent?.ref || documentRef;
    const parentKids = parent?.kids || documentKids;
    const element = context.obj({
      Type: PDFName.of("StructElem"),
      S: PDFName.of(safeRole),
      P: parentRef,
      Pg: page.ref,
      K: PDFNumber.of(mcid),
    });
    const safeActualText = optionalText(actualText);
    if (safeActualText) {
      element.set(
        PDFName.of("ActualText"),
        PDFHexString.fromText(safeActualText),
      );
    }
    const safeAlt = optionalText(alt);
    if (safeAlt) {
      element.set(PDFName.of("Alt"), PDFHexString.fromText(safeAlt));
    }
    const ref = context.register(element);
    parentKids.push(ref);
    state.parents[mcid] = ref;
    return { element, ref, mcid };
  }

  function artifact(page, draw) {
    assertOpen();
    pageState(page);
    page.pushOperators(beginMarkedContent("Artifact"));
    try {
      draw();
    } finally {
      page.pushOperators(endMarkedContent());
    }
  }

  function associateAnnotation(page, structure, annotation, annotationRef) {
    assertOpen();
    pageState(page);
    if (
      !structure?.element
      || !(annotation instanceof PDFDict)
      || !annotationRef
    ) {
      throw new TypeError("A tagged link and annotation are required.");
    }
    const parentKey = nextParentKey;
    nextParentKey += 1;
    annotation.set(PDFName.of("StructParent"), PDFNumber.of(parentKey));
    parentTreeEntries.set(parentKey, structure.ref);

    const objectReference = context.obj({
      Type: PDFName.of("OBJR"),
      Obj: annotationRef,
      Pg: page.ref,
    });
    const elementKids = PDFArray.withContext(context);
    elementKids.push(PDFNumber.of(structure.mcid));
    elementKids.push(objectReference);
    structure.element.set(PDFName.of("K"), elementKids);
  }

  function finalize() {
    assertOpen();
    for (const state of pageStates.values()) {
      const parents = PDFArray.withContext(context);
      for (const parent of state.parents) {
        if (!parent) {
          throw new Error("The PDF parent tree contains an unbound MCID.");
        }
        parents.push(parent);
      }
      parentTreeEntries.set(state.parentKey, parents);
    }

    const nums = PDFArray.withContext(context);
    for (
      const [key, value] of Array.from(parentTreeEntries.entries())
        .sort(([left], [right]) => left - right)
    ) {
      nums.push(PDFNumber.of(key));
      nums.push(value);
    }
    const parentTree = context.obj({ Nums: nums });
    const parentTreeRef = context.register(parentTree);
    root.set(PDFName.of("ParentTree"), parentTreeRef);
    root.set(
      PDFName.of("ParentTreeNextKey"),
      PDFNumber.of(nextParentKey),
    );
    finalized = true;
  }

  return {
    artifact,
    associateAnnotation,
    beginSection,
    finalize,
    mark,
    registerPage,
  };
}
