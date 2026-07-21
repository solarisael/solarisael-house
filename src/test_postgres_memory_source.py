import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("postgres-memory-source.py")
spec = importlib.util.spec_from_file_location("postgres_memory_source", MODULE)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class PostgresMemorySourceRoomTests(unittest.TestCase):
    def test_custom_room_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            room_dir = Path(temp_dir) / "custom-room"
            room_dir.mkdir()
            self.assertEqual(source.resolve_room_name("custom-room", room_dir), "custom-room")

    def test_invalid_room_is_rejected_instead_of_mapped(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            room_dir = Path(temp_dir) / "custom-room"
            room_dir.mkdir()
            for invalid in ("Custom-Room", "custom_room", "custom room", "../kodo"):
                with self.subTest(invalid=invalid):
                    with self.assertRaisesRegex(ValueError, "invalid room key"):
                        source.resolve_room_name(invalid, room_dir)


if __name__ == "__main__":
    unittest.main()
