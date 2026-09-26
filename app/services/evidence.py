import logging
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.schemas.graph import GraphNeighborhoodResponse
from app.schemas.search import SearchResult

logger = logging.getLogger(__name__)


class EvidenceItem(BaseModel):
    """
    Normalized, tamper-proof evidence unit presented to the synthesis LLM.
    Carries verified document provenance, source authority, and graph entity associations.
    """
    evidence_id: str = Field(..., description="Stable identifier e.g. EV_1, EV_2")
    chunk_id: int = 0
    document_id: int
    document_title: str
    page: Optional[int] = None
    content: str
    source_type: str = "official_doc"
    authority_score: float = 1.0
    retrieval_score: float = 0.5
    composite_score: float = 0.5
    entity_ids: List[str] = Field(default_factory=list)
    graph_paths: List[str] = Field(default_factory=list)
    tenant_id: Optional[int] = None


class EvidencePackage(BaseModel):
    items: List[EvidenceItem] = Field(default_factory=list)
    graph_triples: List[str] = Field(default_factory=list)
    candidate_concepts: List[str] = Field(default_factory=list)
    total_retrieved_chunks: int = 0
    top_authority_type: Optional[str] = None

    def __init__(self, **data: Any):
        if "evidence_items" in data and "items" not in data:
            data["items"] = data.pop("evidence_items")
        super().__init__(**data)

    @property
    def evidence_items(self) -> List[EvidenceItem]:
        return self.items

    def format_for_prompt(self) -> str:
        return EvidenceBuilder.format_evidence_prompt_context(self)


class EvidenceBuilder:
    """
    Transforms raw vector search results and knowledge graph subgraphs into
    a normalized, reranked EvidencePackage.
    """

    @classmethod
    def infer_source_type(cls, source_name: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Infers document type from metadata or filename heuristics."""
        if metadata and metadata.get("source_type"):
            return str(metadata["source_type"]).lower()

        lower = source_name.lower()
        if any(k in lower for k in ("regulatory", "policy", "compliance", "regulation", "iso", "legal", "gdpr", "soc2")):
            return "regulatory"
        if any(k in lower for k in ("spec", "architecture", "api", "schema", "code", "rfc", "eng")):
            return "engineering_runbooks"
        if any(k in lower for k in ("guide", "manual", "handbook", "doc", "overview", "product")):
            return "product_docs"
        if any(k in lower for k in ("faq", "troubleshoot", "support", "help", "kb", "ticket")):
            return "support_articles"
        if any(k in lower for k in ("meeting", "sync", "notes", "minutes", "retro", "summary")):
            return "meeting_notes"
        if any(k in lower for k in ("archive", "old", "deprecated", "legacy", "v1", "backup")):
            return "archive"
        return "product_docs"

    @classmethod
    def get_authority_multiplier(
        cls,
        source_type: str,
        authority_policy: Optional[Dict[str, Any]]
    ) -> float:
        """Retrieves configured authority weight for a given source type."""
        if not authority_policy:
            return 1.0
        ranked_types = authority_policy.get("rankedSourceTypes", []) or authority_policy.get("hierarchy", [])
        st_lower = source_type.lower()
        for item in ranked_types:
            if isinstance(item, dict):
                t = str(item.get("type") or item.get("sourceType") or "").lower()
                if t and (t == st_lower or st_lower in t or t in st_lower):
                    return float(item.get("weight", 1.0))
        return 1.0

    @classmethod
    def build_evidence_package(
        cls,
        chunks: List[Any],
        graph: Optional[Any] = None,
        source_authority_policy: Optional[Dict[str, Any]] = None,
        candidate_concepts: Optional[List[str]] = None,
        tenant_id: Optional[int] = None,
        graph_triples: Optional[List[str]] = None,
    ) -> EvidencePackage:
        evidence_items: List[EvidenceItem] = []

        # Graph entity lookup table for chunk associations
        entity_names_by_chunk: Dict[int, List[str]] = {}
        collected_triples: List[str] = []

        if graph_triples:
            for g in graph_triples:
                collected_triples.append(str(g))

        if graph is not None:
            if hasattr(graph, "nodes") and hasattr(graph, "edges"):
                for node in graph.nodes:
                    for cid in getattr(node, "chunk_ids", []):
                        entity_names_by_chunk.setdefault(cid, []).append(node.name)
                for edge in graph.edges:
                    desc = f" ({edge.description})" if getattr(edge, "description", None) else ""
                    collected_triples.append(f"({edge.source}) --[{edge.type}]--> ({edge.target}){desc}")
            elif isinstance(graph, list):
                for g in graph:
                    collected_triples.append(str(g))

        # Construct and score raw evidence items
        raw_items = []
        for chk in chunks:
            if isinstance(chk, dict):
                cid = chk.get("id") or chk.get("chunk_id", 0)
                did = chk.get("document_id") or chk.get("source_id", 0)
                dtitle = chk.get("document_title") or chk.get("source_name", "Document")
                content = chk.get("content", "")
                score = float(chk.get("similarity") or chk.get("score") or 0.5)
                item_tenant_id = chk.get("tenant_id", tenant_id)
            else:
                cid = getattr(chk, "chunk_id", 0)
                did = getattr(chk, "source_id", 0)
                dtitle = getattr(chk, "source_name", "Document")
                content = getattr(chk, "content", "")
                score = float(getattr(chk, "score", 0.5))
                item_tenant_id = tenant_id

            stype = cls.infer_source_type(dtitle)
            auth_weight = cls.get_authority_multiplier(stype, source_authority_policy)
            
            # Composite reranking score combines semantic relevance with authority multiplier
            retrieval_score = round(score, 4)
            composite_score = round(retrieval_score * auth_weight, 4)

            # Connected graph entities for this chunk
            linked_entities = entity_names_by_chunk.get(cid, [])

            raw_items.append({
                "chunk_id": cid,
                "document_id": did,
                "document_title": dtitle,
                "content": content,
                "tenant_id": item_tenant_id,
                "source_type": stype,
                "authority_score": auth_weight,
                "retrieval_score": retrieval_score,
                "composite_score": composite_score,
                "linked_entities": linked_entities,
            })

        # Sort by composite score descending (highest combined relevance and authority first)
        raw_items.sort(key=lambda x: x["composite_score"], reverse=True)

        # Assign deterministic stable evidence IDs: [EV_1], [EV_2], ...
        for idx, item in enumerate(raw_items, 1):
            ev_id = f"EV_{idx}"
            evidence_items.append(
                EvidenceItem(
                    evidence_id=ev_id,
                    chunk_id=item["chunk_id"],
                    document_id=item["document_id"],
                    document_title=item["document_title"],
                    page=None,
                    content=item["content"].strip(),
                    source_type=item["source_type"],
                    authority_score=item["authority_score"],
                    retrieval_score=item["retrieval_score"],
                    composite_score=item["composite_score"],
                    entity_ids=item["linked_entities"],
                    graph_paths=[],
                    tenant_id=item["tenant_id"]
                )
            )

        top_auth = evidence_items[0].source_type if evidence_items else None

        return EvidencePackage(
            items=evidence_items,
            graph_triples=collected_triples,
            candidate_concepts=candidate_concepts or [],
            total_retrieved_chunks=len(chunks),
            top_authority_type=top_auth,
        )

    @classmethod
    def format_evidence_prompt_context(cls, package: EvidencePackage) -> str:
        """
        Formats normalized evidence items into structured prompt context
        with explicit, unambiguous [EV_#] identifiers for model citation.
        """
        sections = []

        # 1. Knowledge Graph Triples Section
        if package.graph_triples:
            sections.append(
                "### 🕸️ VERIFIED KNOWLEDGE GRAPH RELATIONSHIPS:\n" +
                "\n".join([f"- {t}" for t in package.graph_triples])
            )

        # 2. Structured Evidence Items Section
        if package.items:
            item_blocks = ["### 📄 VERIFIED EVIDENCE PASSAGES (Cite with bracketed IDs):"]
            for itm in package.items:
                auth_badge = f"[Authority: {itm.source_type.upper()}]"
                entities_line = f"Linked Entities: {', '.join(itm.entity_ids)}\n" if itm.entity_ids else ""
                item_blocks.append(
                    f"[{itm.evidence_id}] Document: \"{itm.document_title}\" {auth_badge}\n"
                    f"{entities_line}"
                    f"{itm.content}"
                )
            sections.append("\n\n".join(item_blocks))

        # 3. Candidate Concepts
        if package.candidate_concepts:
            sections.append(
                "### 💡 CANDIDATE TOPICS & GRAPH ENTITIES:\n" +
                "\n".join([f"- {c}" for c in package.candidate_concepts])
            )

        if not sections:
            return "No verified evidence passages or graph relationships were found in the organization's knowledge base."

        return "\n\n---\n\n".join(sections)
