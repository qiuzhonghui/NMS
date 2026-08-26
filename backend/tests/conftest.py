"""pytest 路径配置:确保 backend 目录在 sys.path 中,可 import app 包。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
