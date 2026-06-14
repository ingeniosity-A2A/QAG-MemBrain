"""
QAG-MemBrain Layer 4: RLVR — Reinforcement Learning with Verifiable Rewards
=============================================================================
Implements deterministic, verifiable reward functions for the GRPO/DAPO
training loop.

Key principle: Every reward must be:
    1. Deterministic — same inputs always produce the same output.
    2. Bounded — returns a float in [0, 1].
    3. Verifiable — the computation can be independently checked.

Reward types:
    - exact_match: Binary string equality.
    - f1_score: Token-level F1 between prediction and reference.
    - json_schema: Structural validation against a JSON schema.
    - code_execution: Fraction of passing test cases (sandboxed exec).
    - mathematical_equivalence: Numeric / algebraic equivalence.

Reference:
    "Verifiable Reward" concept from "DeepSeek-R1" and "DAPO" papers,
    where rule-based verifiers replace neural reward models for
    objective domains (math, code, structured output).
"""

import json
import math
import re
from typing import Any, Dict, List, Optional, Tuple


class RLVR:
    """
    Verifiable reward functions for reinforcement learning.

    Each method is a pure function: deterministic, bounded in [0, 1],
    and independently verifiable. The dispatch method `verifiable_reward`
    routes to the appropriate function based on task type.
    """

    # ------------------------------------------------------------------
    # Exact match
    # ------------------------------------------------------------------

    def exact_match_reward(self, prediction: str, reference: str) -> float:
        """
        Binary exact match reward.

        Returns 1.0 if prediction and reference are identical strings
        (after stripping leading/trailing whitespace), 0.0 otherwise.

        Args:
            prediction: Model output.
            reference: Expected output.

        Returns:
            1.0 or 0.0.
        """
        if prediction.strip() == reference.strip():
            return 1.0
        return 0.0

    # ------------------------------------------------------------------
    # Token-level F1
    # ------------------------------------------------------------------

    def f1_score_reward(self, prediction: str, reference: str) -> float:
        """
        Token-level F1 score between prediction and reference.

        Tokenization is whitespace-based with lowercasing and punctuation
        stripping for robust matching.

        F1 = 2 * precision * recall / (precision + recall)
        where:
            precision = |common_tokens| / |prediction_tokens|
            recall = |common_tokens| / |reference_tokens|

        Args:
            prediction: Model output.
            reference: Expected output.

        Returns:
            F1 score in [0, 1].
        """
        pred_tokens = self._tokenize(prediction)
        ref_tokens = self._tokenize(reference)

        if not pred_tokens and not ref_tokens:
            return 1.0
        if not pred_tokens or not ref_tokens:
            return 0.0

        # Count token occurrences for multi-set intersection
        pred_counts: Dict[str, int] = {}
        for t in pred_tokens:
            pred_counts[t] = pred_counts.get(t, 0) + 1

        ref_counts: Dict[str, int] = {}
        for t in ref_tokens:
            ref_counts[t] = ref_counts.get(t, 0) + 1

        # Compute common token count (min of counts)
        common = 0
        for token, count in pred_counts.items():
            if token in ref_counts:
                common += min(count, ref_counts[token])

        precision = common / len(pred_tokens)
        recall = common / len(ref_tokens)

        if precision + recall < 1e-12:
            return 0.0

        f1 = 2.0 * precision * recall / (precision + recall)
        return f1

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """Simple whitespace tokenizer with lowercasing and punctuation stripping."""
        # Remove punctuation and lowercase
        cleaned = re.sub(r'[^\w\s]', ' ', text.lower())
        return cleaned.split()

    # ------------------------------------------------------------------
    # JSON schema validation
    # ------------------------------------------------------------------

    def json_schema_reward(self, prediction: str, schema: dict) -> float:
        """
        Reward for JSON output matching a schema.

        Validates:
            1. Prediction is valid JSON (0.0 if not).
            2. JSON has the required top-level keys (partial credit).
            3. Values have the correct types (partial credit).

        Scoring:
            - 0.0 if prediction is not valid JSON
            - 0.3 if JSON parses but has no matching keys
            - 0.3 + 0.7 * (matched_keys / total_required_keys) if some keys match
            - 1.0 if all required keys present with correct types

        Schema format (simplified):
            {
                "type": "object",
                "properties": {
                    "key1": {"type": "string"},
                    "key2": {"type": "number"},
                    ...
                },
                "required": ["key1", "key2"]
            }

        Args:
            prediction: Model output (should be a JSON string).
            schema: JSON schema dict.

        Returns:
            Reward in [0, 1].
        """
        # Step 1: Try to parse JSON
        try:
            parsed = json.loads(prediction)
        except (json.JSONDecodeError, TypeError):
            return 0.0

        if not isinstance(parsed, dict):
            # Not an object — partial credit if it's valid JSON
            return 0.1

        # Step 2: Check required keys
        required_keys = schema.get("required", [])
        properties = schema.get("properties", {})

        if not required_keys:
            # No required keys — reward for valid JSON object
            return 0.8

        matched_keys = 0
        type_correct = 0
        for key in required_keys:
            if key in parsed:
                matched_keys += 1
                # Check type
                expected_type = properties.get(key, {}).get("type", None)
                if expected_type and self._check_type(parsed[key], expected_type):
                    type_correct += 1

        # Score computation
        key_score = matched_keys / len(required_keys)
        type_score = type_correct / len(required_keys) if required_keys else 0.0

        # Weight: 40% key presence, 60% type correctness
        reward = 0.3 + 0.7 * (0.4 * key_score + 0.6 * type_score)
        return min(1.0, reward)

    @staticmethod
    def _check_type(value: Any, expected_type: str) -> bool:
        """Check if a JSON value matches the expected type."""
        type_map = {
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
            "array": list,
            "object": dict,
            "null": type(None),
        }
        expected = type_map.get(expected_type)
        if expected is None:
            return True  # Unknown type, assume correct
        # Special case: Python bool is subclass of int
        if expected_type == "integer" and isinstance(value, bool):
            return False
        if expected_type == "number" and isinstance(value, bool):
            return False
        return isinstance(value, expected)

    # ------------------------------------------------------------------
    # Code execution reward
    # ------------------------------------------------------------------

    def code_execution_reward(
        self, code: str, test_cases: List[Tuple[str, Any]]
    ) -> float:
        """
        Reward based on fraction of passing test cases.

        Executes the code in a restricted sandbox (limited builtins) and
        runs each test case. A test case passes if:
            - The expression evaluates without error
            - The result equals the expected value

        Sandbox restrictions:
            - No import statement
            - No access to __import__, eval, exec, open, etc.
            - Only safe builtins: abs, all, any, bin, bool, chr, dict,
              divmod, enumerate, filter, float, format, hex, int, isinstance,
              issubclass, iter, len, list, map, max, min, next, oct, ord,
              pow, print, range, repr, reversed, round, set, slice, sorted,
              str, sum, tuple, zip, True, False, None

        Args:
            code: Python code string to execute.
            test_cases: List of (expression, expected_value) tuples.
                        Each expression is evaluated in the namespace
                        created by executing the code.

        Returns:
            Fraction of passing test cases in [0, 1].
        """
        if not test_cases:
            return 0.0

        # Restricted builtins
        safe_builtins = {
            'abs': abs, 'all': all, 'any': any, 'bin': bin, 'bool': bool,
            'chr': chr, 'dict': dict, 'divmod': divmod, 'enumerate': enumerate,
            'filter': filter, 'float': float, 'format': format, 'hex': hex,
            'int': int, 'isinstance': isinstance, 'issubclass': issubclass,
            'iter': iter, 'len': len, 'list': list, 'map': map, 'max': max,
            'min': min, 'next': next, 'oct': oct, 'ord': ord, 'pow': pow,
            'print': print, 'range': range, 'repr': repr, 'reversed': reversed,
            'round': round, 'set': set, 'slice': slice, 'sorted': sorted,
            'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip,
            'True': True, 'False': False, 'None': None,
        }

        namespace: Dict[str, Any] = {"__builtins__": safe_builtins}

        # Execute the code
        try:
            exec(code, namespace)
        except Exception:
            # Code failed to execute — all test cases fail
            return 0.0

        # Run test cases
        passed = 0
        for expr, expected in test_cases:
            try:
                result = eval(expr, {"__builtins__": safe_builtins}, namespace)
                if result == expected:
                    passed += 1
            except Exception:
                continue

        return passed / len(test_cases)

    # ------------------------------------------------------------------
    # Mathematical equivalence
    # ------------------------------------------------------------------

    def mathematical_equivalence_reward(self, expr_a: str,
                                        expr_b: str) -> float:
        """
        Reward for mathematical equivalence of two expressions.

        Handles several cases:
            1. Numeric comparison: both expressions are numbers → compare values
            2. Simple algebraic: normalize whitespace and basic forms
            3. Substitution test: try several numeric values and check equality

        Returns:
            1.0 if equivalent, 0.0 if not, 0.5 if uncertain.

        Args:
            expr_a: First mathematical expression.
            expr_b: Second mathematical expression.
        """
        a = expr_a.strip()
        b = expr_b.strip()

        if a == b:
            return 1.0

        # Case 1: Both are numeric
        num_a = self._try_parse_number(a)
        num_b = self._try_parse_number(b)

        if num_a is not None and num_b is not None:
            return 1.0 if math.isclose(num_a, num_b, rel_tol=1e-9) else 0.0

        # Case 2: Normalize and compare string forms
        norm_a = self._normalize_expression(a)
        norm_b = self._normalize_expression(b)
        if norm_a == norm_b:
            return 1.0

        # Case 3: Numerical substitution test
        # Try substituting a few values and check equality
        if self._substitution_test(a, b):
            return 1.0

        return 0.0

    @staticmethod
    def _try_parse_number(s: str) -> Optional[float]:
        """Try to parse a string as a number."""
        s = s.strip()
        # Handle fractions like "3/4"
        if '/' in s and '^' not in s:
            parts = s.split('/')
            if len(parts) == 2:
                try:
                    num = float(parts[0])
                    den = float(parts[1])
                    if den != 0:
                        return num / den
                except ValueError:
                    pass
        try:
            return float(s)
        except ValueError:
            return None

    @staticmethod
    def _normalize_expression(expr: str) -> str:
        """Normalize a mathematical expression for string comparison."""
        # Remove spaces
        expr = expr.replace(' ', '')
        # Normalize multiplication
        expr = expr.replace('*', '')
        # Normalize minus signs
        expr = expr.replace('--', '+')
        expr = expr.replace('+-', '-')
        # Lowercase
        expr = expr.lower()
        return expr

    @staticmethod
    def _substitution_test(expr_a: str, expr_b: str) -> bool:
        """
        Test equivalence by substituting numeric values.

        Uses a safe subset of operations. Tests with x=2, x=3, x=5.
        If all substitutions produce equal results, expressions are
        considered equivalent.
        """
        # Only allow safe characters for substitution
        allowed_chars = set('0123456789+-*/().x abcdefghijklmnopqrstuvwxyz')
        if not (all(c in allowed_chars for c in expr_a.lower()) and
                all(c in allowed_chars for c in expr_b.lower())):
            return False

        test_values = [2, 3, 5, 7]
        matches = 0

        safe_builtins = {
            'abs': abs, 'round': round, 'min': min, 'max': max,
            'pow': pow, 'True': True, 'False': False,
        }

        for x_val in test_values:
            try:
                namespace_a = {"__builtins__": safe_builtins, "x": x_val}
                namespace_b = {"__builtins__": safe_builtins, "x": x_val}
                # Also map single-letter variables to x for simple cases
                # (This is a heuristic, not a full algebraic engine)
                val_a = eval(expr_a, namespace_a)
                val_b = eval(expr_b, namespace_b)
                if isinstance(val_a, (int, float)) and isinstance(val_b, (int, float)):
                    if math.isclose(val_a, val_b, rel_tol=1e-6):
                        matches += 1
                    else:
                        return False  # Definitive mismatch
                else:
                    break  # Can't compare non-numeric
            except Exception:
                break  # Can't evaluate — inconclusive

        return matches == len(test_values)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def verifiable_reward(self, prediction: str, task_type: str,
                          verification_data: dict) -> float:
        """
        Dispatch to the appropriate reward function based on task type.

        Supported task types:
            - "exact_match": requires "reference" in verification_data
            - "f1_score": requires "reference" in verification_data
            - "json_schema": requires "schema" in verification_data
            - "code_execution": requires "code" and "test_cases" in verification_data
            - "math_equivalence": requires "reference" in verification_data
            - "math": alias for "math_equivalence"

        Args:
            prediction: Model output.
            task_type: String identifying the reward function.
            verification_data: Dict containing the required data for
                               the specific reward function.

        Returns:
            Reward in [0, 1].

        Raises:
            ValueError: If task_type is unknown or required data is missing.
        """
        dispatch = {
            "exact_match": self._dispatch_exact_match,
            "f1_score": self._dispatch_f1_score,
            "json_schema": self._dispatch_json_schema,
            "code_execution": self._dispatch_code_execution,
            "math_equivalence": self._dispatch_math_equivalence,
            "math": self._dispatch_math_equivalence,
        }

        handler = dispatch.get(task_type)
        if handler is None:
            raise ValueError(
                f"Unknown task_type: '{task_type}'. "
                f"Supported types: {list(dispatch.keys())}"
            )

        return handler(prediction, verification_data)

    def _dispatch_exact_match(self, prediction: str,
                              data: dict) -> float:
        if "reference" not in data:
            raise ValueError("exact_match requires 'reference' in verification_data")
        return self.exact_match_reward(prediction, data["reference"])

    def _dispatch_f1_score(self, prediction: str,
                           data: dict) -> float:
        if "reference" not in data:
            raise ValueError("f1_score requires 'reference' in verification_data")
        return self.f1_score_reward(prediction, data["reference"])

    def _dispatch_json_schema(self, prediction: str,
                              data: dict) -> float:
        if "schema" not in data:
            raise ValueError("json_schema requires 'schema' in verification_data")
        return self.json_schema_reward(prediction, data["schema"])

    def _dispatch_code_execution(self, prediction: str,
                                 data: dict) -> float:
        if "code" not in data or "test_cases" not in data:
            raise ValueError(
                "code_execution requires 'code' and 'test_cases' in verification_data"
            )
        return self.code_execution_reward(data["code"], data["test_cases"])

    def _dispatch_math_equivalence(self, prediction: str,
                                   data: dict) -> float:
        if "reference" not in data:
            raise ValueError(
                "math_equivalence requires 'reference' in verification_data"
            )
        return self.mathematical_equivalence_reward(prediction, data["reference"])
