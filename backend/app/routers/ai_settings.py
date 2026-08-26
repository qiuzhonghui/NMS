"""AI 设置 API — 配置 AI 分析所需的 API key、模型名等参数。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from loguru import logger
import httpx

from ..database import get_session
from ..models.device_template import AISettings

router = APIRouter(prefix="/ai-settings", tags=["ai-settings"])


class AIConfigSave(BaseModel):
    """AI 配置保存请求。"""
    provider: str = Field(default="openai", description="openai, azure, local, deepseek, custom")
    api_key: str = Field(..., description="API 密钥")
    api_base: str = Field(default="https://api.openai.com/v1", description="API 基础 URL")
    model_name: str = Field(default="gpt-4o-mini", description="模型名称")
    batch_size: int = Field(default=100, description="每轮分析最大OID数量")
    ai_concurrency: int = Field(default=3, description="AI分析并发数")
    request_timeout: int = Field(default=120, description="单次AI请求超时(秒)")
    group_timeout: int = Field(default=180, description="并发组超时(秒)")
    enabled: bool = Field(default=True, description="是否启用")


@router.get("")
async def get_ai_settings(session: AsyncSession = Depends(get_session)):
    """获取 AI 配置（API key 脱敏显示）。"""
    result = await session.execute(select(AISettings).limit(1))
    config = result.scalar_one_or_none()
    if not config:
        return {"configured": False, "provider": "openai", "api_key": "",
                "api_base": "https://api.openai.com/v1", "model_name": "gpt-4o-mini",
                "batch_size": 100, "ai_concurrency": 3, "request_timeout": 120, "group_timeout": 180, "enabled": False}

    # 脱敏显示 API key
    masked_key = config.api_key[:8] + "****" + config.api_key[-4:] if len(config.api_key) > 12 else "****"

    return {
        "id": config.id,
        "provider": config.provider,
        "api_key": masked_key,
        "api_base": config.api_base,
        "model_name": config.model_name,
        "batch_size": config.batch_size or 100,
        "ai_concurrency": config.ai_concurrency or 3,
        "request_timeout": config.request_timeout or 120,
        "group_timeout": config.group_timeout or 180,
        "enabled": config.enabled,
        "configured": True,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.post("")
async def save_ai_settings(data: AIConfigSave, session: AsyncSession = Depends(get_session)):
    """保存 AI 配置（存在则更新，不存在则创建）。"""
    result = await session.execute(select(AISettings).limit(1))
    config = result.scalar_one_or_none()

    if config:
        # 更新现有配置（如果 api_key 是脱敏的则保留原值）
        if "****" in data.api_key:
            pass  # 保留原 api_key
        else:
            config.api_key = data.api_key
        config.provider = data.provider
        config.api_base = data.api_base
        config.model_name = data.model_name
        config.batch_size = data.batch_size
        config.ai_concurrency = data.ai_concurrency
        config.request_timeout = data.request_timeout
        config.group_timeout = data.group_timeout
        config.enabled = data.enabled
    else:
        config = AISettings(
            provider=data.provider,
            api_key=data.api_key,
            api_base=data.api_base,
            model_name=data.model_name,
            batch_size=data.batch_size,
            ai_concurrency=data.ai_concurrency,
            request_timeout=data.request_timeout,
            group_timeout=data.group_timeout,
            enabled=data.enabled
        )
        session.add(config)

    await session.commit()
    logger.info(f"AI settings saved: provider={data.provider}, model={data.model_name}")
    return {"status": "ok", "provider": data.provider, "model_name": data.model_name}


@router.post("/test")
async def test_ai_connection(session: AsyncSession = Depends(get_session)):
    """测试 AI API 连接是否正常。"""
    result = await session.execute(select(AISettings).limit(1))
    config = result.scalar_one_or_none()
    if not config or not config.enabled:
        raise HTTPException(400, "AI 未配置或未启用")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # 尝试获取模型列表来测试连接
            resp = await client.get(
                f"{config.api_base}/models",
                headers={"Authorization": f"Bearer {config.api_key}"}
            )
            if resp.status_code == 200:
                data = resp.json()
                models = [m.get("id", "") for m in data.get("data", [])[:10]]
                return {"status": "ok", "message": "连接成功", "available_models": models}
            else:
                return {"status": "error", "message": f"API 返回 {resp.status_code}: {resp.text[:200]}"}
    except httpx.TimeoutException:
        raise HTTPException(504, "连接超时，请检查 API Base URL 是否正确")
    except Exception as e:
        raise HTTPException(500, f"连接失败: {str(e)}")
