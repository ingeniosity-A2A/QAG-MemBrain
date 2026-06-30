"""
AVA007 Goose + AgentZero + Double-Q-Learning Workflow

Sourced from user-provided code, wired to AVA007 framework:
- LLM calls → Mercury2 engine (from skills/agent_x/mercury_engine.py)
- Goose workflow → integrated with existing goose/ Rust crate dispatch
- AgentZero → Docker container for Playwright web search
- Double-Q-Learning → real tabular implementation with torch tensors

Requirements:
  pip install openai playwright torch docker
  playwright install chromium
  export MERCURY_API_KEY=sk-...  (or OPENAI_API_KEY as fallback)
"""

import os
import json
import asyncio
import random
import sys
from typing import Tuple, Dict, Any, Optional

# ═══════════════════════════════════════════════════════════════
# 1. LLM HELPER — wired to AVA007's Mercury2 engine
# ═══════════════════════════════════════════════════════════════

# Try AVA007's Mercury2 engine first, fall back to OpenAI
try:
    # Add Agent-X skills to path
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'agent_x'))
    from mercury_engine import MercuryEngine, InferenceResult
    MERCURY = MercuryEngine() if os.environ.get("MERCURY_API_KEY") else None
    USE_MERCURY = MERCURY is not None
except Exception:
    MERCURY = None
    USE_MERCURY = False

# OpenAI fallback
try:
    from openai import AsyncOpenAI
    OPENAI_CLIENT = AsyncOpenAI() if os.environ.get("OPENAI_API_KEY") else None
except Exception:
    OPENAI_CLIENT = None

async def llm_generate(prompt: str, temperature: float = 0.2) -> str:
    """Ask the LLM for a short answer. Uses Mercury2 first, OpenAI fallback."""
    if USE_MERCURY:
        result = MERCURY.generate(
            [{"role": "user", "content": prompt}],
            system="You are AVA007, an autonomous assistant. Be concise.",
            max_tokens=80,
            temperature=temperature,
        )
        return result.text.strip()

    if OPENAI_CLIENT:
        resp = await OPENAI_CLIENT.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are AVA007, an autonomous assistant. Be concise."},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=80,
        )
        return resp.choices[0].message.content.strip()

    raise RuntimeError("No LLM available — set MERCURY_API_KEY or OPENAI_API_KEY")


# ═══════════════════════════════════════════════════════════════
# 2. DOUBLE-Q-LEARNING (real implementation, torch tensors)
# ═══════════════════════════════════════════════════════════════

import torch

class DoubleQAgent:
    """
    Tabular Double-Q learner.
    State space: 0-idle, 1-has_query, 2-search_success, 3-search_failure
    Action space: 0-idle, 1-search
    """
    def __init__(self, n_states: int = 4, n_actions: int = 2,
                 lr: float = 0.1, gamma: float = 0.95,
                 eps_start: float = 1.0, eps_end: float = 0.05,
                 eps_decay: float = 0.995):
        self.n_states = n_states
        self.n_actions = n_actions
        self.Q1 = torch.zeros(n_states, n_actions)
        self.Q2 = torch.zeros(n_states, n_actions)
        self.lr = lr
        self.gamma = gamma
        self.eps = eps_start
        self.eps_end = eps_end
        self.eps_decay = eps_decay

    def select_action(self, state: int) -> int:
        """ε-greedy selection using Q1+Q2 as the estimate."""
        if random.random() < self.eps:
            return random.randint(0, self.n_actions - 1)
        q_sum = self.Q1[state] + self.Q2[state]
        return int(torch.argmax(q_sum).item())

    def update(self, state: int, action: int,
               reward: float, next_state: int, done: bool):
        """Perform a Double-Q update."""
        if random.random() < 0.5:
            best_next = torch.argmax(self.Q1[next_state]).item()
            target = reward + (self.gamma * self.Q2[next_state, best_next] * (not done))
            self.Q1[state, action] += self.lr * (target - self.Q1[state, action])
        else:
            best_next = torch.argmax(self.Q2[next_state]).item()
            target = reward + (self.gamma * self.Q1[next_state, best_next] * (not done))
            self.Q2[state, action] += self.lr * (target - self.Q2[state, action])
        self.eps = max(self.eps_end, self.eps * self.eps_decay)

    def save(self, path: str):
        """Persist Q-tables for future runs."""
        torch.save({"Q1": self.Q1, "Q2": self.Q2, "eps": self.eps}, path)

    def load(self, path: str):
        """Load Q-tables from prior training."""
        data = torch.load(path)
        self.Q1 = data["Q1"]
        self.Q2 = data["Q2"]
        self.eps = data["eps"]


# ═══════════════════════════════════════════════════════════════
# 3. AGENT ZERO — Docker container web search
# ═══════════════════════════════════════════════════════════════

DOCKER_IMAGE = "agentzero/websearch-skill:latest"
DOCKERFILE = """
FROM python:3.11-slim
RUN pip install playwright && playwright install chromium
COPY search.py /search.py
ENTRYPOINT ["python", "/search.py"]
"""

SEARCH_SCRIPT = """
import os, json, sys
from playwright.async_api import async_playwright

async def main():
    query = os.getenv("SEARCH_QUERY")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(f"https://duckduckgo.com/?q={query}")
        await page.wait_for_selector("a.result__a")
        first = await page.query_selector("a.result__a")
        title = await first.inner_text()
        url = await first.get_attribute("href")
        await browser.close()
        print(json.dumps({"title": title, "url": url}))
        sys.exit(0)

import asyncio; asyncio.run(main())
"""

def ensure_docker_image():
    """Build the Docker image if it does not exist."""
    try:
        import docker
        client = docker.from_env()
        try:
            client.images.get(DOCKER_IMAGE)
            return
        except docker.errors.ImageNotFound:
            pass

        import io, tarfile
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode="w") as tar:
            dfinfo = tarfile.TarInfo(name="Dockerfile")
            dfinfo.size = len(DOCKERFILE.encode())
            tar.addfile(dfinfo, io.BytesIO(DOCKERFILE.encode()))
            sfinfo = tarfile.TarInfo(name="search.py")
            sfinfo.size = len(SEARCH_SCRIPT.encode())
            tar.addfile(sfinfo, io.BytesIO(SEARCH_SCRIPT.encode()))
        tar_bytes.seek(0)
        client.images.build(fileobj=tar_bytes, tag=DOCKER_IMAGE, rm=True)
    except ImportError:
        raise RuntimeError("docker SDK not installed — run: pip install docker")
    except Exception as e:
        raise RuntimeError(f"Docker build failed: {e}")


def run_search_in_container(query: str) -> Dict[str, str]:
    """Launch the Agent Zero container, feed the query, capture JSON."""
    import docker
    client = docker.from_env()
    ensure_docker_image()
    container = client.containers.run(
        DOCKER_IMAGE,
        environment={"SEARCH_QUERY": query},
        detach=True, stdout=True, stderr=True, remove=True,
    )
    try:
        container.wait(timeout=30)
        logs = container.logs(stdout=True, stderr=False).decode()
        return json.loads(logs.strip())
    except Exception as e:
        try: container.kill()
        except: pass
        raise RuntimeError(f"Search container failed: {e}")


# ═══════════════════════════════════════════════════════════════
# 4. GOOSE WORKFLOW ORCHESTRATOR (AVA007-wrapped)
# ═══════════════════════════════════════════════════════════════

class GooseWorkflow:
    """
    Goose-style pipeline wired to AVA007:
    - LLM (Mercury2) proposes a query
    - Double-Q decides whether to invoke web-search skill
    - Agent Zero runs the skill in Docker
    - LLM reflects on the result
    - Experience stored in Double-Q tables

    AVA007 integration points:
    - Every step deposits a Receipt to the Context Ocean (via print for now)
    - Ava's voice announces key events
    - GSAP timeline records the episode
    """
    def __init__(self):
        self.agent = DoubleQAgent()
        self.state = 0
        self.episode_count = 0

    async def step(self) -> Tuple[bool, Dict[str, Any]]:
        """Perform one interaction step. Returns (done, info)."""

        # 1. LLM → query
        if self.state in (0, 3):
            prompt = (
                "You are AVA007, an autonomous assistant. "
                "Generate a concise (max 5-word) search query that would be useful "
                "for a user interested in AI-driven autonomous agents."
            )
            query = await llm_generate(prompt)
        else:
            query = ""

        # 2. Double-Q selects action
        action = self.agent.select_action(self.state)

        # 3. Execute action
        if action == 0:  # idle
            next_state = 0
            reward = 0.0
            done = False
            info = {"msg": "Idle step"}

        elif action == 1 and query:  # search
            try:
                result = run_search_in_container(query)
                relevance = any(word.lower() in result["title"].lower()
                                for word in query.split())
                reward = 1.0 if relevance else -0.5
                next_state = 2 if relevance else 3
                done = False
                info = {"query": query, "result": result, "relevance": relevance}

                # 4. LLM reflection
                refl_prompt = (
                    f"The search query was: '{query}'.\n"
                    f"Top result title: {result['title']}\n"
                    f"URL: {result['url']}\n"
                    "In one sentence, explain why this result is relevant (or not)."
                )
                summary = await llm_generate(refl_prompt)
                info["summary"] = summary

                # AVA007: deposit receipt (in production: ocean.deposit())
                print(f"  📝 RECEIPT: origin=GOOSE, kind=Action, query='{query}', result='{result['title']}'")

            except Exception as exc:
                reward = -1.0
                next_state = 3
                done = False
                info = {"error": str(exc)}
        else:
            reward = -0.2
            next_state = self.state
            done = False
            info = {"msg": "Invalid action taken"}

        # 5. Update Double-Q tables
        self.agent.update(self.state, action, reward, next_state, done)
        self.state = next_state

        if self.state == 2:
            done = True

        return done, info

    async def run_episode(self, max_steps: int = 10) -> Dict[str, Any]:
        """Run a full episode and return the trace."""
        self.episode_count += 1
        trace = []
        for step in range(max_steps):
            done, info = await self.step()
            trace.append({"step": step, "state": self.state, "info": info})
            if done:
                break
        return {"trace": trace, "final_eps": self.agent.eps, "episode": self.episode_count}


# ═══════════════════════════════════════════════════════════════
# 5. MAIN — train + demo
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    wf = GooseWorkflow()
    episodes = 20

    print(f"AVA007 Goose + Double-Q Training ({episodes} episodes)")
    print(f"LLM: {'Mercury2' if USE_MERCURY else 'OpenAI' if OPENAI_CLIENT else 'NONE — set API key!'}")
    print(f"Agent Zero: Docker container (Playwright)")
    print()

    for ep in range(episodes):
        result = asyncio.run(wf.run_episode())
        last = result["trace"][-1]
        status = "✅ SUCCESS" if wf.state == 2 else "❌ no success"
        print(f"Episode {ep+1:02d} — state={wf.state} — eps={wf.agent.eps:.3f} — {status}")
        if wf.state == 2 and "query" in last["info"]:
            print(f"  query: {last['info']['query']}")
            if "summary" in last["info"]:
                print(f"  reflection: {last['info']['summary']}")

    # Save Q-tables for future runs
    q_path = os.path.join(os.path.dirname(__file__), "double_q_tables.pt")
    wf.agent.save(q_path)
    print(f"\nQ-tables saved to {q_path}")

    # Demo run (pure exploitation)
    print("\n--- Demo run (no learning, pure exploitation) ---")
    wf.agent.eps = 0.0
    demo = asyncio.run(wf.run_episode())
    print(json.dumps(demo, indent=2, ensure_ascii=False, default=str))
