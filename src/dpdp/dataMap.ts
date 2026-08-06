import { redactLikelyPii } from "./evidence";
import type {
  ControlResult,
  DataCategory,
  DataMapEdge,
  DataMapEdgeRelation,
  DataMapNode,
  EvidenceItem,
  PersonalDataMap,
  PersonalDataMapGraph,
  TechnicalSignalBag
} from "./types";

const DISCLAIMER =
  "Personal-data processing map for DPDP technical readiness. Values are masked/classified. Not a legal processing record of processing activities (RoPA) substitute.";

function safeLabel(value: string): string {
  return redactLikelyPii(value).slice(0, 160);
}

function edgeId(from: string, to: string, relation: DataMapEdgeRelation): string {
  return `edge:${relation}:${from}->${to}`;
}

/**
 * Build a lightweight evidence graph from map aggregates + evidence ledger.
 * Labels are classified/masked only — never raw PII.
 */
export function buildDataMapGraph(
  categories: PersonalDataMap["categories"],
  collectionPoints: PersonalDataMap["collectionPoints"],
  stores: PersonalDataMap["stores"],
  externalRecipients: PersonalDataMap["externalRecipients"],
  lifecycleSignals: PersonalDataMap["lifecycleSignals"],
  safeguardGaps: PersonalDataMap["safeguardGaps"],
  relatedControls: string[],
  evidence: EvidenceItem[]
): PersonalDataMapGraph {
  const nodes = new Map<string, DataMapNode>();
  const edges = new Map<string, DataMapEdge>();

  const addNode = (node: DataMapNode): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, {
        ...node,
        label: safeLabel(node.label)
      });
    }
  };

  const addEdge = (from: string, to: string, relation: DataMapEdgeRelation): void => {
    if (!nodes.has(from) || !nodes.has(to)) {
      return;
    }
    const id = edgeId(from, to, relation);
    if (!edges.has(id)) {
      edges.set(id, { id, from, to, relation });
    }
  };

  for (const category of categories) {
    addNode({
      id: `category:${category.category}`,
      kind: "category",
      label: category.category,
      category: category.category,
      evidenceIds: category.evidenceIds
    });
  }

  for (const point of collectionPoints) {
    addNode({
      id: `collection:${point.id}`,
      kind: "collection",
      label: point.summary,
      file: point.file,
      line: point.line,
      evidenceIds: point.evidenceIds
    });
  }

  for (const store of stores) {
    addNode({
      id: `store:${store.id}`,
      kind: "store",
      label: store.summary,
      file: store.file,
      evidenceIds: store.evidenceIds
    });
  }

  for (const recipient of externalRecipients) {
    addNode({
      id: `external:${recipient.id}`,
      kind: "external",
      label: `${recipient.name} (${recipient.kind})`,
      file: recipient.file,
      evidenceIds: recipient.evidenceIds
    });
  }

  for (const lifecycle of lifecycleSignals) {
    addNode({
      id: `lifecycle:${lifecycle.id}`,
      kind: "lifecycle",
      label: lifecycle.summary,
      file: lifecycle.file,
      line: lifecycle.line,
      evidenceIds: lifecycle.evidenceIds
    });
  }

  for (const gap of safeguardGaps) {
    addNode({
      id: `gap:${gap.id}`,
      kind: "safeguard_gap",
      label: gap.summary,
      file: gap.file,
      line: gap.line,
      evidenceIds: gap.evidenceIds
    });
  }

  for (const controlId of relatedControls) {
    addNode({
      id: `control:${controlId}`,
      kind: "control",
      label: controlId
    });
  }

  // Field / category evidence nodes and relations
  for (const item of evidence) {
    if (item.kind === "declared_assertion" || item.kind === "skip_or_capability") {
      continue;
    }

    if (item.field || item.kind === "field_or_column") {
      const fieldId = `field:${item.id}`;
      addNode({
        id: fieldId,
        kind: "field",
        label: item.field ? safeLabel(item.field) : safeLabel(item.summary),
        category: item.dataCategory,
        file: item.file,
        line: item.line,
        evidenceIds: [item.id]
      });
      if (item.dataCategory) {
        addEdge(fieldId, `category:${item.dataCategory}`, "instance_of");
      }
      if (item.file) {
        // Link field to co-located store/collection by file
        for (const store of stores) {
          if (store.file === item.file) {
            addEdge(fieldId, `store:${store.id}`, "stored_in");
          }
        }
        for (const point of collectionPoints) {
          if (point.file === item.file) {
            addEdge(fieldId, `collection:${point.id}`, "collected_at");
          }
        }
      }
      for (const controlId of item.relatedControls) {
        addEdge(fieldId, `control:${controlId}`, "related_control");
      }
    } else if (item.dataCategory) {
      for (const controlId of item.relatedControls) {
        addEdge(`category:${item.dataCategory}`, `control:${controlId}`, "related_control");
      }
    }
  }

  // Co-location and flow edges by shared file
  for (const point of collectionPoints) {
    if (!point.file) {
      continue;
    }
    for (const store of stores) {
      if (store.file === point.file) {
        addEdge(`collection:${point.id}`, `store:${store.id}`, "stored_in");
      }
    }
    for (const recipient of externalRecipients) {
      if (recipient.file === point.file) {
        addEdge(`collection:${point.id}`, `external:${recipient.id}`, "sent_to");
      }
    }
    for (const category of categories) {
      // Category ↔ collection when any category evidence shares the file
      const sharesFile = evidence.some(
        (item) => item.dataCategory === category.category && item.file === point.file
      );
      if (sharesFile) {
        addEdge(`category:${category.category}`, `collection:${point.id}`, "collected_at");
      }
    }
  }

  for (const store of stores) {
    if (!store.file) {
      continue;
    }
    for (const recipient of externalRecipients) {
      if (recipient.file === store.file) {
        addEdge(`store:${store.id}`, `external:${recipient.id}`, "sent_to");
      }
    }
    for (const category of categories) {
      const sharesFile = evidence.some(
        (item) => item.dataCategory === category.category && item.file === store.file
      );
      if (sharesFile) {
        addEdge(`category:${category.category}`, `store:${store.id}`, "stored_in");
      }
    }
    for (const lifecycle of lifecycleSignals) {
      if (lifecycle.file === store.file) {
        addEdge(`lifecycle:${lifecycle.id}`, `store:${store.id}`, "lifecycle_of");
      }
    }
  }

  for (const gap of safeguardGaps) {
    if (!gap.file) {
      continue;
    }
    for (const store of stores) {
      if (store.file === gap.file) {
        addEdge(`gap:${gap.id}`, `store:${store.id}`, "protected_by");
      }
    }
    for (const point of collectionPoints) {
      if (point.file === gap.file) {
        addEdge(`gap:${gap.id}`, `collection:${point.id}`, "protected_by");
      }
    }
    for (const recipient of externalRecipients) {
      if (recipient.file === gap.file) {
        addEdge(`gap:${gap.id}`, `external:${recipient.id}`, "protected_by");
      }
    }
  }

  // Co-locate external + category when same file
  for (const recipient of externalRecipients) {
    if (!recipient.file) {
      continue;
    }
    for (const category of categories) {
      const sharesFile = evidence.some(
        (item) => item.dataCategory === category.category && item.file === recipient.file
      );
      if (sharesFile) {
        addEdge(`category:${category.category}`, `external:${recipient.id}`, "sent_to");
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: Array.from(edges.values()).sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function buildPersonalDataMap(
  signals: TechnicalSignalBag[],
  evidence: EvidenceItem[],
  controls: ControlResult[],
  generatedAt: string
): PersonalDataMap {
  const categoryMap = new Map<DataCategory, string[]>();
  for (const item of evidence) {
    if (!item.dataCategory) {
      continue;
    }
    const list = categoryMap.get(item.dataCategory) ?? [];
    list.push(item.id);
    categoryMap.set(item.dataCategory, list);
  }

  const collectionPoints = signals
    .filter((signal) => signal.kind === "collection" || signal.tags.includes("collection-point"))
    .map((signal) => ({
      id: signal.id,
      kind: "collection",
      file: signal.file,
      line: signal.line,
      summary: safeLabel(signal.summary),
      evidenceIds: [signal.id]
    }));

  const stores = signals
    .filter((signal) => signal.kind === "storage" || signal.tags.includes("pii-store") || signal.kind === "retention")
    .map((signal) => ({
      id: signal.id,
      kind: signal.tags.includes("retention-present") ? "retention" : "storage",
      file: signal.file,
      summary: safeLabel(signal.summary),
      evidenceIds: [signal.id]
    }));

  const externalRecipients = signals
    .filter((signal) => signal.kind === "external")
    .map((signal) => {
      const nameTag = signal.tags.find((tag) => !["external-processor", "lockfile-processor", "cross-border"].includes(tag));
      return {
        id: signal.id,
        name: nameTag ?? "external-service",
        kind:
          signal.tags.find((tag) =>
            [
              "analytics",
              "error_tracking",
              "telemetry",
              "messaging",
              "payments",
              "identity",
              "advertising",
              "llm",
              "cloud",
              "vector_db",
              "mcp"
            ].includes(tag)
          ) ?? "external",
        file: signal.file,
        summary: safeLabel(signal.summary),
        evidenceIds: [signal.id]
      };
    });

  const lifecycleSignals = signals
    .filter(
      (signal) =>
        ["consent", "deletion", "rights", "retention"].includes(signal.kind) ||
        signal.tags.some((tag) =>
          [
            "consent-capture",
            "consent-withdrawal",
            "erasure-path",
            "access-export",
            "correction-path",
            "grievance",
            "retention-present"
          ].includes(tag)
        )
    )
    .map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      file: signal.file,
      line: signal.line,
      summary: safeLabel(signal.summary),
      evidenceIds: [signal.id]
    }));

  const safeguardGaps = signals
    .filter((signal) => signal.kind === "safeguard_gap")
    .map((signal) => ({
      id: signal.id,
      kind: "safeguard_gap",
      file: signal.file,
      line: signal.line,
      summary: safeLabel(signal.summary),
      evidenceIds: [signal.id]
    }));

  const categories = Array.from(categoryMap.entries())
    .map(([category, evidenceIds]) => ({
      category,
      count: evidenceIds.length,
      evidenceIds: Array.from(new Set(evidenceIds))
    }))
    .sort((left, right) => left.category.localeCompare(right.category));

  const relatedControls = Array.from(
    new Set(controls.filter((item) => item.applicable).map((item) => item.controlId))
  ).sort();

  const graph = buildDataMapGraph(
    categories,
    dedupeById(collectionPoints),
    dedupeById(stores),
    dedupeById(externalRecipients),
    dedupeById(lifecycleSignals),
    dedupeById(safeguardGaps),
    relatedControls,
    evidence
  );

  return {
    version: 1,
    generatedAt,
    disclaimer: DISCLAIMER,
    categories,
    collectionPoints: dedupeById(collectionPoints),
    stores: dedupeById(stores),
    externalRecipients: dedupeById(externalRecipients),
    lifecycleSignals: dedupeById(lifecycleSignals),
    safeguardGaps: dedupeById(safeguardGaps),
    relatedControls,
    graph
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}
