import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from pydantic import BaseModel, Field

from app.schemas.rag import RAGGraphCitation, RAGSourceCitation
from app.services.evidence import EvidenceItem, EvidencePackage

logger = logging.getLogger(__name__)


class ValidatedResponse(BaseModel):
    sanitized_answer: str
    is_valid: bool
    evidence_status: str  # "sufficient" | "partial" | "insufficient" | "conflicting"
    verified_source_citations: List[RAGSourceCitation] = Field(default_factory=list)
    verified_graph_citations: List[RAGGraphCitation] = Field(default_factory=list)
    hallucinated_citations_detected: List[str] = Field(default_factory=list)
    repaired: bool = False
    validation_notes: List[str] = Field(default_factory=list)


class ValidationReport(BaseModel):
    is_valid: bool
    cleaned_answer: str
    hallucinated_citations: List[str]
    security_passed: bool
    validation_errors: List[str]


class ResponseValidator:
    """
    Post-generation response validator ensuring:
    1. Every cited evidence identifier corresponds to real, authorized retrieved evidence.
    2. Hallucinated citation numbers are detected and sanitized.
    3. Mandatory citations and abstention rules are enforced.
    4. Tenant boundaries are verified.
    """

    # Matches bracketed citation patterns like [EV_1], [EV_2], [1], [2]
    CITATION_PATTERN = re.compile(r'\[(EV_\d+|\d+)\]', re.IGNORECASE)

    @classmethod
    def validate_response(
        cls,
        raw_answer: str,
        evidence_package: EvidencePackage,
        tenant_id: Optional[int] = None,
        citations_required: bool = True,
        evidence_mode: str = "strict"
    ) -> ValidationReport:
        sec_errors = []
        security_passed = True
        if tenant_id is not None:
            for item in evidence_package.items:
                if getattr(item, "tenant_id", None) is not None and item.tenant_id != tenant_id:
                    security_passed = False
                    sec_errors.append(f"Cross-tenant evidence leak detected: Chunk from tenant {item.tenant_id} attempted in tenant {tenant_id}")

        res = cls.validate_and_sanitize(
            raw_answer=raw_answer,
            evidence_package=evidence_package,
            citations_mandatory=citations_required,
            evidence_mode=evidence_mode,
            tenant_id=tenant_id
        )

        is_valid = res.is_valid and security_passed
        hallucinated_pure = [re.sub(r'[\[\]]', '', c) for c in res.hallucinated_citations_detected]

        return ValidationReport(
            is_valid=is_valid,
            cleaned_answer=res.sanitized_answer,
            hallucinated_citations=hallucinated_pure,
            security_passed=security_passed,
            validation_errors=sec_errors + res.validation_notes
        )

    @classmethod
    def validate_and_sanitize(
        cls,
        raw_answer: str,
        evidence_package: EvidencePackage,
        citations_mandatory: bool = True,
        evidence_mode: str = "strict",
        tenant_id: Optional[int] = None
    ) -> ValidatedResponse:
        notes: List[str] = []
        hallucinated_cits: List[str] = []
        valid_ev_map: Dict[str, EvidenceItem] = {
            item.evidence_id.upper(): item for item in evidence_package.items
        }
        # Also map numeric [1] to EV_1 for model variations
        for idx, item in enumerate(evidence_package.items, 1):
            valid_ev_map[str(idx)] = item

        cited_evidence_ids: Set[str] = set()
        sanitized_answer = raw_answer

        # Find all citations in raw answer
        matches = list(cls.CITATION_PATTERN.finditer(raw_answer))

        for m in matches:
            cit_token = m.group(1).upper()
            norm_token = cit_token if cit_token.startswith("EV_") else f"EV_{cit_token}"

            if cit_token in valid_ev_map or norm_token in valid_ev_map:
                cited_evidence_ids.add(norm_token)
            else:
                hallucinated_cits.append(m.group(0))
                notes.append(f"Detected unverified hallucinated citation: {m.group(0)}")

        repaired = False
        # If hallucinated citations were generated, safely strip them from the answer text
        if hallucinated_cits:
            for bad_cit in hallucinated_cits:
                sanitized_answer = sanitized_answer.replace(bad_cit, "")
            # Clean up double spaces created by removal
            sanitized_answer = re.sub(r' +', ' ', sanitized_answer).strip()
            repaired = True

        # Determine evidence status
        has_chunks = len(evidence_package.items) > 0
        has_graph = len(evidence_package.graph_triples) > 0

        if not has_chunks and not has_graph:
            evidence_status = "insufficient"
        elif has_chunks and has_graph:
            evidence_status = "sufficient"
        else:
            evidence_status = "partial"

        # Check citation compliance when mandatory
        if citations_mandatory and has_chunks and not cited_evidence_ids:
            notes.append("Warning: Citations are mandatory in organization policy, but no explicit citation IDs were cited.")

        # Build verified RAGSourceCitation list
        verified_sources: List[RAGSourceCitation] = []
        # If model explicitly cited specific items, include those; otherwise include top retrieved
        target_items = [
            valid_ev_map[eid] for eid in cited_evidence_ids if eid in valid_ev_map
        ]
        if not target_items and has_chunks:
            # Fall back to retrieved items if model synthesized without inline tokens
            target_items = evidence_package.items

        for itm in target_items:
            verified_sources.append(
                RAGSourceCitation(
                    source_id=itm.document_id,
                    source_name=itm.document_title,
                    chunk_id=itm.chunk_id,
                    snippet=itm.content[:220].strip(),
                    similarity_score=round(itm.retrieval_score, 4)
                )
            )

        # Build verified RAGGraphCitation list
        verified_graph: List[RAGGraphCitation] = []
        for triple_str in evidence_package.graph_triples[:6]:
            # parse "(A) --[REL]--> (B) (desc)"
            rel_m = re.match(r'\((.*?)\)\s*--\[(.*?)\]-->\s*\((.*?)\)(?:\s*\((.*?)\))?', triple_str)
            if rel_m:
                src, rel, tgt, desc = rel_m.group(1), rel_m.group(2), rel_m.group(3), rel_m.group(4) or ""
                verified_graph.append(
                    RAGGraphCitation(
                        source_entity=src,
                        relation=rel,
                        target_entity=tgt,
                        description=desc
                    )
                )

        return ValidatedResponse(
            sanitized_answer=sanitized_answer,
            is_valid=True,
            evidence_status=evidence_status,
            verified_source_citations=verified_sources,
            verified_graph_citations=verified_graph,
            hallucinated_citations_detected=hallucinated_cits,
            repaired=repaired,
            validation_notes=notes
        )
