import asyncio


async def run(data):
    await asyncio.sleep(0)
    return {"async": True}
