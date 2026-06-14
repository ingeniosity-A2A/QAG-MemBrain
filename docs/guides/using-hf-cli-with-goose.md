# Using the Hugging Face hf CLI with Goose / QAG-MemBrain

## Overview

The official `hf` CLI is optimized for both humans and coding agents. It dramatically reduces token usage (up to 6x on complex tasks) compared to raw SDK or curl.

## Installation

```bash
curl -LsSf https://hf.co/cli/install.sh | bash
hf auth login
```

## Add the Skill

```bash
hf skills add
hf skills add --claude
```

## Example Prompts

- "Use `hf` to upload this folder as a new model repo with proper tags."
- "Sync my bucket and create a collection of trending models."
- "Open a PR adding a license to my dataset."

## Benefits

- Agent-mode TSV output
- Next-command hints
- `--dry-run`, `--yes`, idempotent ops

## Links

- Official Guide: https://huggingface.co/docs/huggingface_hub/guides/cli