"""Standard-library-only boundary for private extraction outputs."""

from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
PRIVATE_ROOT = (REPOSITORY / ".local-game").resolve()


def only_private_output(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(PRIVATE_ROOT) or resolved == PRIVATE_ROOT:
        raise ValueError("Extraction output must be a child of the repository .local-game directory")
    return resolved
