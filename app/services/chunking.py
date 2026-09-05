import re
from typing import List, Optional
from app.core.config import settings


class RecursiveTextSplitter:
    """
    Hierarchical, recursive text splitter with sliding-window chunk overlap.
    Preserves paragraph and sentence boundaries before resorting to word-level splits.
    """

    DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", " ", ""]

    def __init__(
        self,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        separators: Optional[List[str]] = None
    ):
        self.chunk_size = chunk_size or settings.DEFAULT_CHUNK_SIZE
        self.chunk_overlap = chunk_overlap or settings.DEFAULT_CHUNK_OVERLAP
        self.separators = separators or self.DEFAULT_SEPARATORS

        if self.chunk_overlap >= self.chunk_size:
            raise ValueError(
                f"chunk_overlap ({self.chunk_overlap}) must be smaller than chunk_size ({self.chunk_size})"
            )

    def _estimate_tokens(self, text: str) -> int:
        """Estimate token count (approx. 4 characters per token)."""
        return max(1, int(len(text) / 4))

    def _split_into_raw_chunks(self, text: str, separators: List[str]) -> List[str]:
        """Recursively splits text using the hierarchy of separators."""
        text = text.strip()
        if not text:
            return []

        if len(text) <= self.chunk_size:
            return [text]

        # 1. Find the highest-priority separator present in the text
        chosen_separator = ""
        separator_index = len(separators) - 1

        for idx, sep in enumerate(separators):
            if sep == "":
                chosen_separator = ""
                separator_index = idx
                break
            if sep in text:
                chosen_separator = sep
                separator_index = idx
                break

        # 2. Split text by the chosen separator
        if chosen_separator != "":
            splits = text.split(chosen_separator)
        else:
            # Character-level split if no separator matches
            splits = list(text)

        # 3. Merge splits while enforcing chunk_size and sliding window chunk_overlap
        final_chunks: List[str] = []
        current_pieces: List[str] = []
        current_len = 0

        next_separators = separators[separator_index + 1:] if separator_index + 1 < len(separators) else [""]

        for piece in splits:
            if not piece:
                continue

            # If a single piece exceeds chunk_size, split it with sub-separators
            if len(piece) > self.chunk_size:
                # Flush existing buffer first
                if current_pieces:
                    merged = chosen_separator.join(current_pieces).strip()
                    if merged:
                        final_chunks.append(merged)
                    current_pieces = []
                    current_len = 0

                sub_chunks = self._split_into_raw_chunks(piece, next_separators)
                final_chunks.extend(sub_chunks)
                continue

            piece_len = len(piece) + (len(chosen_separator) if current_pieces else 0)

            if current_len + piece_len <= self.chunk_size:
                current_pieces.append(piece)
                current_len += piece_len
            else:
                # Flush the current chunk
                merged = chosen_separator.join(current_pieces).strip()
                if merged:
                    final_chunks.append(merged)

                # Slide the overlap window from previous pieces
                overlap_pieces: List[str] = []
                overlap_len = 0

                for prev in reversed(current_pieces):
                    add_len = len(prev) + (len(chosen_separator) if overlap_pieces else 0)
                    if overlap_len + add_len <= self.chunk_overlap:
                        overlap_pieces.insert(0, prev)
                        overlap_len += add_len
                    else:
                        break

                current_pieces = overlap_pieces + [piece]
                current_len = sum(len(p) for p in current_pieces) + len(chosen_separator) * max(0, len(current_pieces) - 1)

        # Flush any trailing pieces
        if current_pieces:
            merged = chosen_separator.join(current_pieces).strip()
            if merged:
                final_chunks.append(merged)

        return final_chunks

    def split_text(self, text: str) -> List[dict]:
        """
        Splits text into structured chunk metadata dicts.
        """
        raw_chunks = self._split_into_raw_chunks(text, self.separators)
        structured = []

        for idx, chunk_content in enumerate(raw_chunks):
            content_clean = chunk_content.strip()
            if not content_clean:
                continue

            structured.append({
                "chunk_index": idx,
                "content": content_clean,
                "char_count": len(content_clean),
                "token_count": self._estimate_tokens(content_clean),
            })

        return structured
