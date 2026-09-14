"""主键生成 —— 中立模块,不依赖任何 ORM 模型。

原先 ``gen_uuid`` 定义在 ``models/device.py``,被其它 8 个模型文件导入,
导致「device 模块坏掉 → 全部模型的 metadata 都无法构建」的强耦合。
放在这里后,模型之间不再通过 device.py 互相牵连。

(``models/device.py`` 仍然 re-export 该函数,保持既有引用可用。)
"""
import uuid


def gen_uuid() -> str:
    """生成 32 位十六进制主键。"""
    return uuid.uuid4().hex
