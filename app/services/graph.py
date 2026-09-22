import asyncio
import logging
from abc import ABC, abstractmethod
from collections import deque
from typing import Dict, List, Optional, Set, Tuple

from app.core.config import settings
from app.schemas.disambiguation import CandidateEntity
from app.schemas.graph import (
    GraphEdge,
    GraphExtractionResult,
    GraphNeighborhoodResponse,
    GraphNode,
    GraphStatsResponse,
)

logger = logging.getLogger(__name__)


class BaseGraphStore(ABC):
    """Abstract base class for multi-tenant Knowledge Graph operations."""

    @abstractmethod
    async def insert_graph(
        self, tenant_id: int, source_id: int, chunk_id: int, graph: GraphExtractionResult
    ) -> None:
        """Upsert entities and relationships into the tenant's knowledge graph."""
        pass

    @abstractmethod
    async def get_neighborhood(
        self, tenant_id: int, entity_names: List[str], max_hops: int = 1, limit: int = 25
    ) -> GraphNeighborhoodResponse:
        """Retrieve connected subgraphs up to max_hops away from seed entities."""
        pass

    @abstractmethod
    async def get_stats(self, tenant_id: int) -> GraphStatsResponse:
        """Get summary node and edge counts for a tenant."""
        pass

    @abstractmethod
    async def delete_tenant_source_graph(self, tenant_id: int, source_id: int) -> None:
        """Delete graph elements linked to a specific source."""
        pass

    @abstractmethod
    async def delete_tenant_graph(self, tenant_id: int) -> None:
        """Purge an entire tenant's graph upon account deletion."""
        pass

    @abstractmethod
    async def find_candidate_entities(
        self, tenant_id: int, query: str, limit: int = 5
    ) -> List[CandidateEntity]:
        """Fuzzy-match entities in tenant subgraph and collect 1-hop neighbor names."""
        pass

    @abstractmethod
    async def get_popular_topics(
        self, tenant_id: int, limit: int = 5
    ) -> List[str]:
        """Retrieve high-degree central nodes in the tenant's graph."""
        pass


class InMemoryGraphStore(BaseGraphStore):
    """
    In-memory graph store for fast unit testing and offline development.
    Guarantees strict tenant-scoped dictionary partitioning.
    """

    def __init__(self):
        # tenant_id -> entity_name -> node_dict
        self._nodes: Dict[int, Dict[str, dict]] = {}
        # tenant_id -> (source_name, target_name, rel_type) -> edge_dict
        self._edges: Dict[int, Dict[Tuple[str, str, str], dict]] = {}

    def _ensure_tenant(self, tenant_id: int):
        if tenant_id not in self._nodes:
            self._nodes[tenant_id] = {}
        if tenant_id not in self._edges:
            self._edges[tenant_id] = {}

    async def insert_graph(
        self, tenant_id: int, source_id: int, chunk_id: int, graph: GraphExtractionResult
    ) -> None:
        self._ensure_tenant(tenant_id)
        t_nodes = self._nodes[tenant_id]
        t_edges = self._edges[tenant_id]

        # 1. Upsert entities
        for ent in graph.entities:
            name = ent.name.strip()
            if not name:
                continue

            if name in t_nodes:
                # Merge chunk IDs and sources
                if chunk_id not in t_nodes[name]["chunk_ids"]:
                    t_nodes[name]["chunk_ids"].append(chunk_id)
                if source_id not in t_nodes[name]["source_ids"]:
                    t_nodes[name]["source_ids"].append(source_id)
            else:
                t_nodes[name] = {
                    "name": name,
                    "type": ent.type,
                    "description": ent.description or "",
                    "chunk_ids": [chunk_id],
                    "source_ids": [source_id],
                }

        # 2. Upsert relationships
        for rel in graph.relationships:
            src = rel.source.strip()
            tgt = rel.target.strip()
            rel_type = rel.relation_type.strip().upper()

            if not src or not tgt or src not in t_nodes or tgt not in t_nodes:
                continue

            key = (src, tgt, rel_type)
            if key in t_edges:
                t_edges[key]["weight"] += 1
                if source_id not in t_edges[key]["source_ids"]:
                    t_edges[key]["source_ids"].append(source_id)
            else:
                t_edges[key] = {
                    "source": src,
                    "target": tgt,
                    "type": rel_type,
                    "description": rel.description or "",
                    "weight": 1,
                    "source_ids": [source_id],
                }

    async def get_neighborhood(
        self, tenant_id: int, entity_names: List[str], max_hops: int = 1, limit: int = 25
    ) -> GraphNeighborhoodResponse:
        self._ensure_tenant(tenant_id)
        t_nodes = self._nodes[tenant_id]
        t_edges = self._edges[tenant_id]

        matched_nodes: Dict[str, GraphNode] = {}
        matched_edges: List[GraphEdge] = []
        visited_edges: Set[Tuple[str, str, str]] = set()

        # Seed BFS queue: (node_name, current_hop)
        if not entity_names:
            queue = deque([(name, 0) for name in list(t_nodes.keys())[:limit]])
        else:
            queue = deque([(name, 0) for name in entity_names if name in t_nodes])
        visited_nodes: Set[str] = {name for name, _ in queue}

        while queue and (len(matched_edges) < limit or len(matched_nodes) < limit):
            current_name, hop = queue.popleft()
            node_data = t_nodes[current_name]
            matched_nodes[current_name] = GraphNode(
                name=node_data["name"],
                type=node_data["type"],
                description=node_data["description"],
                chunk_ids=node_data["chunk_ids"],
            )

            if hop >= max_hops:
                continue

            # Find all connected edges
            for (src, tgt, rtype), edge_data in t_edges.items():
                connected = None
                if src == current_name:
                    connected = tgt
                elif tgt == current_name:
                    connected = src

                if connected and connected in t_nodes:
                    edge_key = (src, tgt, rtype)
                    if edge_key not in visited_edges and len(matched_edges) < limit:
                        visited_edges.add(edge_key)
                        matched_edges.append(
                            GraphEdge(
                                source=src,
                                target=tgt,
                                type=rtype,
                                description=edge_data["description"],
                                weight=edge_data["weight"],
                            )
                        )
                        if connected not in visited_nodes:
                            visited_nodes.add(connected)
                            queue.append((connected, hop + 1))

        # Ensure all nodes mentioned in matched edges are included
        for edge in matched_edges:
            for n_name in [edge.source, edge.target]:
                if n_name not in matched_nodes and n_name in t_nodes:
                    nd = t_nodes[n_name]
                    matched_nodes[n_name] = GraphNode(
                        name=nd["name"],
                        type=nd["type"],
                        description=nd["description"],
                        chunk_ids=nd["chunk_ids"],
                    )

        return GraphNeighborhoodResponse(
            nodes=list(matched_nodes.values()), edges=matched_edges
        )

    async def get_stats(self, tenant_id: int) -> GraphStatsResponse:
        self._ensure_tenant(tenant_id)
        return GraphStatsResponse(
            node_count=len(self._nodes[tenant_id]),
            edge_count=len(self._edges[tenant_id]),
            tenant_id=tenant_id,
        )

    async def delete_tenant_source_graph(self, tenant_id: int, source_id: int) -> None:
        self._ensure_tenant(tenant_id)
        t_nodes = self._nodes[tenant_id]
        t_edges = self._edges[tenant_id]

        # 1. Remove edges linked to this source
        to_delete_edges = [
            k for k, v in t_edges.items() if source_id in v["source_ids"]
        ]
        for k in to_delete_edges:
            del t_edges[k]

        # 2. Prune source_id from nodes; delete node if no sources remain
        to_delete_nodes = []
        for name, node in t_nodes.items():
            if source_id in node["source_ids"]:
                node["source_ids"].remove(source_id)
            if not node["source_ids"]:
                to_delete_nodes.append(name)

        for name in to_delete_nodes:
            del t_nodes[name]

    async def delete_tenant_graph(self, tenant_id: int) -> None:
        if tenant_id in self._nodes:
            del self._nodes[tenant_id]
        if tenant_id in self._edges:
            del self._edges[tenant_id]

    async def find_candidate_entities(
        self, tenant_id: int, query: str, limit: int = 5
    ) -> List[CandidateEntity]:
        self._ensure_tenant(tenant_id)
        t_nodes = self._nodes[tenant_id]
        t_edges = self._edges[tenant_id]
        query_lower = query.lower().strip()
        query_words = set(query_lower.split())

        scored_candidates = []
        for name, data in t_nodes.items():
            name_lower = name.lower()
            desc_lower = (data.get("description") or "").lower()
            name_words = set(name_lower.split())

            score = 0.0
            if query_lower in name_lower or name_lower in query_lower:
                score += 1.0
            overlap = len(query_words.intersection(name_words))
            if overlap > 0:
                score += overlap * 0.8
            if any(w in desc_lower for w in query_words if len(w) > 2):
                score += 0.3

            if score > 0:
                # 1-hop connected neighbors
                neighbors = []
                for (src, tgt, _rtype) in t_edges.keys():
                    if src == name and tgt != name and tgt not in neighbors:
                        neighbors.append(tgt)
                    elif tgt == name and src != name and src not in neighbors:
                        neighbors.append(src)

                scored_candidates.append(
                    (score, CandidateEntity(
                        name=name,
                        type=data.get("type", "CONCEPT"),
                        description=data.get("description", ""),
                        neighbors=neighbors[:6],
                        score=round(score, 2)
                    ))
                )

        scored_candidates.sort(key=lambda x: x[0], reverse=True)
        return [c for _, c in scored_candidates[:limit]]

    async def get_popular_topics(
        self, tenant_id: int, limit: int = 5
    ) -> List[str]:
        self._ensure_tenant(tenant_id)
        t_nodes = self._nodes[tenant_id]
        t_edges = self._edges[tenant_id]

        degrees: Dict[str, int] = {name: 0 for name in t_nodes}
        for (src, tgt, _rtype), ed in t_edges.items():
            weight = ed.get("weight", 1)
            if src in degrees:
                degrees[src] += weight
            if tgt in degrees:
                degrees[tgt] += weight

        sorted_topics = sorted(degrees.items(), key=lambda x: (x[1], x[0]), reverse=True)
        return [name for name, _ in sorted_topics[:limit]]


class Neo4jGraphStore(BaseGraphStore):
    """
    Neo4j Graph Database implementation using the official async driver and Bolt protocol.
    Enforces multi-tenant isolation by stamping tenant_id on all nodes and relationships.
    """

    def __init__(self, uri: str, auth: Tuple[str, str]):
        from neo4j import AsyncGraphDatabase

        self.driver = AsyncGraphDatabase.driver(uri, auth=auth)
        self._initialized = False

    async def initialize(self):
        """Creates unique constraints to optimize Cypher lookups and guarantee isolation."""
        if self._initialized:
            return
        async with self.driver.session() as session:
            try:
                # Composite constraint for tenant_id and name
                await session.run(
                    "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE (e.tenant_id, e.name) IS UNIQUE"
                )
                self._initialized = True
            except Exception as e:
                logger.warning(f"Neo4j constraint creation notice: {e}")

    async def insert_graph(
        self, tenant_id: int, source_id: int, chunk_id: int, graph: GraphExtractionResult
    ) -> None:
        await self.initialize()
        entities_data = [
            {"name": e.name.strip(), "type": e.type, "description": e.description}
            for e in graph.entities
            if e.name.strip()
        ]
        relationships_data = [
            {
                "source": r.source.strip(),
                "target": r.target.strip(),
                "type": r.relation_type.strip().upper(),
                "description": r.description,
            }
            for r in graph.relationships
            if r.source.strip() and r.target.strip()
        ]

        async with self.driver.session() as session:
            # 1. Upsert Entities
            if entities_data:
                cypher_nodes = """
                UNWIND $entities AS ent
                MERGE (e:Entity {tenant_id: $tenant_id, name: ent.name})
                ON CREATE SET e.type = ent.type,
                              e.description = ent.description,
                              e.chunk_ids = [$chunk_id],
                              e.source_ids = [$source_id]
                ON MATCH SET e.chunk_ids = CASE WHEN NOT $chunk_id IN e.chunk_ids THEN e.chunk_ids + $chunk_id ELSE e.chunk_ids END,
                             e.source_ids = CASE WHEN NOT $source_id IN e.source_ids THEN e.source_ids + $source_id ELSE e.source_ids END
                """
                await session.run(
                    cypher_nodes,
                    tenant_id=tenant_id,
                    entities=entities_data,
                    chunk_id=chunk_id,
                    source_id=source_id,
                )

            # 2. Upsert Relationships
            if relationships_data:
                cypher_edges = """
                UNWIND $relationships AS rel
                MATCH (a:Entity {tenant_id: $tenant_id, name: rel.source})
                MATCH (b:Entity {tenant_id: $tenant_id, name: rel.target})
                MERGE (a)-[r:RELATION {tenant_id: $tenant_id, type: rel.type}]->(b)
                ON CREATE SET r.description = rel.description, r.weight = 1, r.source_ids = [$source_id]
                ON MATCH SET r.weight = r.weight + 1,
                             r.source_ids = CASE WHEN NOT $source_id IN r.source_ids THEN r.source_ids + $source_id ELSE r.source_ids END
                """
                await session.run(
                    cypher_edges,
                    tenant_id=tenant_id,
                    relationships=relationships_data,
                    source_id=source_id,
                )

    async def get_neighborhood(
        self, tenant_id: int, entity_names: List[str], max_hops: int = 1, limit: int = 25
    ) -> GraphNeighborhoodResponse:
        await self.initialize()

        nodes_dict: Dict[str, GraphNode] = {}
        edges_list: List[GraphEdge] = []
        seen_edges: Set[Tuple[str, str, str]] = set()

        if entity_names:
            cypher = f"""
            MATCH (start:Entity {{tenant_id: $tenant_id}})
            WHERE start.name IN $entity_names
            OPTIONAL MATCH path = (start)-[r:RELATION*1..{max_hops}]-(connected:Entity {{tenant_id: $tenant_id}})
            RETURN start, path
            LIMIT $limit
            """
            async with self.driver.session() as session:
                result = await session.run(
                    cypher, tenant_id=tenant_id, entity_names=entity_names, limit=limit
                )
                records = [rec async for rec in result]

            for rec in records:
                start_node = rec["start"]
                s_name = start_node.get("name")
                if s_name and s_name not in nodes_dict:
                    nodes_dict[s_name] = GraphNode(
                        name=s_name,
                        type=start_node.get("type", "CONCEPT"),
                        description=start_node.get("description", ""),
                        chunk_ids=start_node.get("chunk_ids", []),
                    )

                path = rec.get("path")
                if path:
                    for n in path.nodes:
                        name = n.get("name")
                        if name and name not in nodes_dict:
                            nodes_dict[name] = GraphNode(
                                name=name,
                                type=n.get("type", "CONCEPT"),
                                description=n.get("description", ""),
                                chunk_ids=n.get("chunk_ids", []),
                            )
                    for rel in path.relationships:
                        src = rel.start_node.get("name")
                        tgt = rel.end_node.get("name")
                        rtype = rel.get("type", "RELATES_TO")
                        key = (src, tgt, rtype)
                        if key not in seen_edges and len(edges_list) < limit:
                            seen_edges.add(key)
                            edges_list.append(
                                GraphEdge(
                                    source=src,
                                    target=tgt,
                                    type=rtype,
                                    description=rel.get("description", ""),
                                    weight=rel.get("weight", 1),
                                )
                            )
        else:
            cypher = """
            MATCH (start:Entity {tenant_id: $tenant_id})
            WITH start LIMIT $limit
            OPTIONAL MATCH (start)-[r:RELATION {tenant_id: $tenant_id}]-(connected:Entity {tenant_id: $tenant_id})
            RETURN start, r, connected
            """
            async with self.driver.session() as session:
                result = await session.run(
                    cypher, tenant_id=tenant_id, limit=limit
                )
                records = [rec async for rec in result]

            def _add_node(nd):
                if not nd:
                    return
                name = nd.get("name")
                if name and name not in nodes_dict:
                    nodes_dict[name] = GraphNode(
                        name=name,
                        type=nd.get("type", "CONCEPT"),
                        description=nd.get("description", ""),
                        chunk_ids=nd.get("chunk_ids", []),
                    )

            for rec in records:
                _add_node(rec.get("start"))
                _add_node(rec.get("connected"))

                rel = rec.get("r")
                if rel:
                    src = rel.start_node.get("name")
                    tgt = rel.end_node.get("name")
                    rtype = rel.get("type", "RELATES_TO")
                    key = (src, tgt, rtype)
                    if key not in seen_edges and len(edges_list) < limit:
                        seen_edges.add(key)
                        edges_list.append(
                            GraphEdge(
                                source=src,
                                target=tgt,
                                type=rtype,
                                description=rel.get("description", ""),
                                weight=rel.get("weight", 1),
                            )
                        )

        return GraphNeighborhoodResponse(nodes=list(nodes_dict.values()), edges=edges_list)

    async def get_stats(self, tenant_id: int) -> GraphStatsResponse:
        await self.initialize()
        cypher = """
        MATCH (n:Entity {tenant_id: $tenant_id})
        OPTIONAL MATCH (n)-[r:RELATION {tenant_id: $tenant_id}]->()
        RETURN count(DISTINCT n) AS node_count, count(DISTINCT r) AS edge_count
        """
        async with self.driver.session() as session:
            result = await session.run(cypher, tenant_id=tenant_id)
            single = await result.single()
            node_count = single["node_count"] if single else 0
            edge_count = single["edge_count"] if single else 0
            return GraphStatsResponse(
                node_count=node_count, edge_count=edge_count, tenant_id=tenant_id
            )

    async def delete_tenant_source_graph(self, tenant_id: int, source_id: int) -> None:
        await self.initialize()
        # 1. Prune edges associated with this source
        cypher_edges = """
        MATCH (a:Entity {tenant_id: $tenant_id})-[r:RELATION {tenant_id: $tenant_id}]->(b:Entity {tenant_id: $tenant_id})
        WHERE $source_id IN r.source_ids
        SET r.source_ids = [sid IN r.source_ids WHERE sid <> $source_id]
        WITH r WHERE size(r.source_ids) = 0
        DELETE r
        """
        # 2. Prune nodes whose sources have all been removed
        cypher_nodes = """
        MATCH (e:Entity {tenant_id: $tenant_id})
        WHERE $source_id IN e.source_ids
        SET e.source_ids = [sid IN e.source_ids WHERE sid <> $source_id]
        WITH e WHERE size(e.source_ids) = 0
        DETACH DELETE e
        """
        async with self.driver.session() as session:
            await session.run(cypher_edges, tenant_id=tenant_id, source_id=source_id)
            await session.run(cypher_nodes, tenant_id=tenant_id, source_id=source_id)

    async def delete_tenant_graph(self, tenant_id: int) -> None:
        await self.initialize()
        cypher = """
        MATCH (n:Entity {tenant_id: $tenant_id})
        DETACH DELETE n
        """
        async with self.driver.session() as session:
            await session.run(cypher, tenant_id=tenant_id)

    async def find_candidate_entities(
        self, tenant_id: int, query: str, limit: int = 5
    ) -> List[CandidateEntity]:
        await self.initialize()
        clean_query = query.strip()
        cypher = """
        MATCH (e:Entity {tenant_id: $tenant_id})
        WHERE toLower(e.name) CONTAINS toLower($query) 
           OR toLower($query) CONTAINS toLower(e.name)
           OR (e.description IS NOT NULL AND toLower(e.description) CONTAINS toLower($query))
        OPTIONAL MATCH (e)-[:RELATION]-(neighbor:Entity {tenant_id: $tenant_id})
        RETURN e.name AS name, 
               e.type AS type, 
               e.description AS description, 
               collect(DISTINCT neighbor.name)[..6] AS neighbors
        LIMIT $limit
        """
        async with self.driver.session() as session:
            result = await session.run(cypher, tenant_id=tenant_id, query=clean_query, limit=limit)
            records = [rec async for rec in result]

        return [
            CandidateEntity(
                name=rec["name"],
                type=rec.get("type", "CONCEPT"),
                description=rec.get("description", ""),
                neighbors=rec.get("neighbors", []),
            )
            for rec in records
        ]

    async def get_popular_topics(
        self, tenant_id: int, limit: int = 5
    ) -> List[str]:
        await self.initialize()
        cypher = """
        MATCH (e:Entity {tenant_id: $tenant_id})
        OPTIONAL MATCH (e)-[r:RELATION]-()
        RETURN e.name AS name, count(r) AS degree
        ORDER BY degree DESC, e.name ASC
        LIMIT $limit
        """
        async with self.driver.session() as session:
            result = await session.run(cypher, tenant_id=tenant_id, limit=limit)
            records = [rec async for rec in result]

        return [rec["name"] for rec in records if rec.get("name")]


# Singleton instances
_in_memory_store = InMemoryGraphStore()
_neo4j_store: Optional[Neo4jGraphStore] = None
_neo4j_loop: Optional[asyncio.AbstractEventLoop] = None


async def reset_graph_store() -> None:
    """Safely close and reset the active graph store instance."""
    global _neo4j_store, _neo4j_loop
    if _neo4j_store is not None:
        try:
            await _neo4j_store.driver.close()
        except Exception:
            pass
    _neo4j_store = None
    _neo4j_loop = None


async def get_graph_store() -> BaseGraphStore:
    """
    Factory returning Neo4jGraphStore if reachable, otherwise gracefully falling back
    to InMemoryGraphStore.
    Recreates the driver instance if running in a different event loop (e.g. per-test loops in pytest).
    """
    global _neo4j_store, _neo4j_loop
    if settings.GRAPH_ENABLED:
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if (
            _neo4j_store is not None
            and _neo4j_loop is current_loop
            and current_loop is not None
            and not current_loop.is_closed()
        ):
            return _neo4j_store

        # Loop changed or uninitialized: create a fresh driver bound to the active loop
        _neo4j_store = None
        _neo4j_loop = None

        try:
            store = Neo4jGraphStore(
                uri=settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            )
            # Verify connectivity
            await store.driver.verify_connectivity()
            _neo4j_store = store
            _neo4j_loop = current_loop
            logger.info("Connected successfully to Neo4j graph database.")
            return _neo4j_store
        except Exception as e:
            logger.info(
                f"Neo4j instance at {settings.NEO4J_URI} not currently reachable ({e}). Using in-memory graph store."
            )
            return _in_memory_store

    return _in_memory_store
