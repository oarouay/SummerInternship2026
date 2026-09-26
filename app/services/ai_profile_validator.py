import logging
from typing import Any, Dict, List, Optional
from app.schemas.ai_profile import ProfileValidationResult

logger = logging.getLogger(__name__)


class AIProfileValidator:
    """
    Validates AI Profile and Persona configurations, catching contradictory,
    unsafe, or out-of-bounds enterprise settings before persistence.
    """

    @classmethod
    def validate_profile_dict(cls, data: Dict[str, Any]) -> ProfileValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        # 1. Validate Retrieval Policy
        retrieval = data.get("retrieval_policy") or {}
        max_hops = retrieval.get("maxGraphDepth", 2)
        if not (1 <= max_hops <= 4):
            errors.append(f"Invalid maxGraphDepth: {max_hops}. Graph depth must be between 1 and 4 hops.")

        top_k = retrieval.get("topK", 4)
        if not (1 <= top_k <= 20):
            errors.append(f"Invalid topK: {top_k}. Top-k retrieval must be between 1 and 20 passages.")

        min_threshold = retrieval.get("minEvidenceThreshold", 0.35)
        if not (0.0 <= min_threshold <= 1.0):
            errors.append("minEvidenceThreshold must be between 0.0 and 1.0.")

        vec_weight = retrieval.get("vectorWeight", 0.6)
        graph_weight = retrieval.get("graphWeight", 0.4)
        if vec_weight < 0 or graph_weight < 0:
            errors.append("Retrieval weights (vectorWeight, graphWeight) must be non-negative.")
        if (vec_weight + graph_weight) == 0:
            errors.append("Combined retrieval weights cannot sum to zero.")
        elif abs((vec_weight + graph_weight) - 1.0) > 0.05:
            errors.append(f"Combined retrieval weights (vectorWeight + graphWeight = {round(vec_weight + graph_weight, 2)}) must sum to 1.0.")

        # 2. Validate Citation Policy & Grounding Invariants
        citation = data.get("citation_policy") or {}
        evidence = data.get("evidence_policy") or {}

        citations_required = citation.get("citationsRequired", True)
        grounded_only = evidence.get("groundedOnly", True)
        allow_prior_knowledge = evidence.get("allowModelPriorKnowledge", False)
        allow_unsupported = evidence.get("allowUnsupportedClaims", False)

        # Contradiction: groundedOnly cannot coexist with allowUnsupportedClaims
        if grounded_only and allow_unsupported:
            errors.append(
                "Contradiction detected: 'groundedOnly' is enabled, but 'allowUnsupportedClaims' is set to true. "
                "Unsupported claims are prohibited under grounded enterprise policies."
            )

        # Contradiction: groundedOnly cannot allow ungrounded prior knowledge
        if grounded_only and allow_prior_knowledge:
            warnings.append(
                "'allowModelPriorKnowledge' is enabled while 'groundedOnly' is active. "
                "Enterprise RAG answers may synthesize outside parametric knowledge unless strictly grounded."
            )

        # 3. Validate Source Authority Policy
        source_auth = data.get("source_authority_policy") or {}
        ranked_types = source_auth.get("rankedSourceTypes") or []
        if not ranked_types:
            warnings.append("No ranked source authority types specified. Default uniform ranking will be applied.")
        else:
            ranks = [r.get("rank") for r in ranked_types if isinstance(r, dict)]
            if len(ranks) != len(set(ranks)):
                errors.append("Source authority ranks must be unique with no duplicate rankings.")
            for r in ranked_types:
                w = r.get("weight", 1.0)
                if w <= 0:
                    errors.append(f"Authority weight for source type '{r.get('type')}' must be greater than zero.")

        # 4. Validate Conflict Policy
        conflict = data.get("conflict_policy") or {}
        strategy = conflict.get("strategy", "show_both")
        valid_strategies = ["show_both", "prefer_highest_authority", "prefer_latest", "require_human_review"]
        if strategy not in valid_strategies:
            errors.append(f"Invalid conflict strategy: '{strategy}'. Must be one of {valid_strategies}.")

        # 5. Validate Organization Data
        org = data.get("organization_data") or {}
        terminology = org.get("terminology") or []
        for term_item in terminology:
            if isinstance(term_item, dict):
                t = term_item.get("term", "").strip()
                d = term_item.get("definition", "").strip()
                if not t or not d:
                    warnings.append(f"Incomplete terminology definition found: term='{t}', def='{d}'. Both should be non-empty.")

        return ProfileValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )

    @classmethod
    def validate_persona_against_profile(
        cls,
        persona_data: Dict[str, Any],
        profile_data: Dict[str, Any]
    ) -> ProfileValidationResult:
        """
        Enforces organization-level policy precedence over persona preferences.
        Organization mandatory rules (such as mandatory citations or grounded-only)
        CANNOT be overridden by a persona.
        """
        errors: List[str] = []
        warnings: List[str] = []

        # Validate mandatory persona fields
        if not persona_data.get("name", "").strip():
            errors.append("Persona name cannot be empty.")
        if not persona_data.get("role", "").strip():
            errors.append("Persona role cannot be empty.")
        if not persona_data.get("purpose", "").strip():
            errors.append("Persona purpose cannot be empty.")

        # Precedence checks:
        citation_policy = profile_data.get("citation_policy") or {}
        if citation_policy.get("citationsRequired", True):
            # If organization mandates citations, persona must not declare no-citation mode
            if persona_data.get("disable_citations", False) or persona_data.get("citation_override") is False:
                errors.append(
                    "Organization policy mandates citations for all answers. "
                    "Individual personas cannot disable citations."
                )

        evidence_policy = profile_data.get("evidence_policy") or {}
        if evidence_policy.get("groundedOnly", True):
            if persona_data.get("allow_hallucination", False) or persona_data.get("creative_mode", False):
                errors.append(
                    "Organization policy strictly mandates grounded synthesis. "
                    "Individual personas cannot enable ungrounded creative extrapolation."
                )

        return ProfileValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings
        )
