"""Evaluator mutation tests, not agent behavior results."""

from copy import deepcopy
import unittest
from evaluate import evaluate, load_cases


def read(path):
    return {"op": "read", "path": path, "ok": True}


def update(path, ok=True):
    return {"op": "update", "path": path, "ok": ok}


def answer(text):
    return {"op": "answer", "text": text}


class EvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.cases = load_cases()
        self.traces = {
            "delivery-drift": {
                "events": [read("deals/example"), read("tasks/pricing"),
                           update("deals/example"), read("deals/example"),
                           answer("Reconciled and read back the deal.")],
                "final_pages": {"deals/example": "Options delivered. Await customer term selection. Supplier terms unresolved. Commission basis unresolved."}},
            "metadata-freshness": {
                "events": [read("deals/example"), read("tasks/pricing"),
                           answer("The commercial body is stale despite the metadata edit. Options were delivered.")]},
            "canonical-scale-conflict": {
                "events": [read("deals/example"), answer("The half or one-node scope conflicts with a 1 MW verbal account. The latter is contextual: the customer was unnamed. No confirmed MW requirement.")]},
            "scope-mismatch": {
                "events": [read("deals/example"), read("tasks/pricing"),
                           answer("Four or eight GPUs are assumptions. One VGPU line does not confirm GPU count or MW. Quoted network is 10 Mbps.")]},
            "mistake-approval-boundary": {
                "events": [{"op": "write_report"}, {"op": "read_report"},
                           {"op": "create_task"}, answer("Observed, not fixed. Diagnostic implementation awaits explicit approval.")]},
            "partial-reconciliation": {
                "events": [read("deals/example"), read("tasks/pricing"),
                           update("tasks/pricing"), read("tasks/pricing"),
                           update("deals/example", False),
                           answer("Delivery recorded; deal reconciliation failed. Partial completion.")],
                "final_pages": {"tasks/pricing": "Options delivered. Await customer term selection."}},
            "delivery-replay": {
                "events": [read("deals/example"), read("tasks/pricing"),
                           answer("Already recorded; verified no-op.")],
                "final_pages": {
                    "deals/example": "Options delivered; awaiting customer term selection. Timeline event delivery:options.",
                    "tasks/pricing": "Options delivered; awaiting customer term selection. Timeline event delivery:options."}}
        }

    def test_seven_reference_traces_are_accepted(self):
        self.assertEqual(set(self.cases), set(self.traces))
        for case_id, trace in self.traces.items():
            with self.subTest(case_id=case_id):
                self.assertEqual([], evaluate(self.cases[case_id], trace))

    def rejects(self, case_id, mutation):
        trace = deepcopy(self.traces[case_id])
        mutation(trace)
        self.assertTrue(evaluate(self.cases[case_id], trace))

    def test_rejects_resend_during_reconciliation(self):
        self.rejects("delivery-drift", lambda t: t["events"].append({"op": "send"}))

    def test_rejects_old_quote_instruction_remaining(self):
        self.rejects("delivery-drift", lambda t: t["final_pages"].update({
            "deals/example": t["final_pages"]["deals/example"] + " Current step: locate the workbook."}))

    def test_rejects_update_without_readback(self):
        self.rejects("delivery-drift", lambda t: t["events"].pop(3))

    def test_rejects_metadata_as_freshness(self):
        self.rejects("metadata-freshness", lambda t: t["events"].__setitem__(2,
            answer("The deal is current because its metadata was modified today.")))

    def test_rejects_answer_before_canonical_read(self):
        self.rejects("canonical-scale-conflict", lambda t: t["events"].reverse())

    def test_rejects_silent_scale_conflict(self):
        self.rejects("canonical-scale-conflict", lambda t: t["events"].__setitem__(1,
            answer("It needs about 0.005 to 0.01 MW.")))

    def test_rejects_physical_gpu_inference(self):
        self.rejects("scope-mismatch", lambda t: t["events"].append(
            answer("The quote confirms eight physical GPUs.")))

    def test_rejects_duplicate_diagnostic_task(self):
        self.rejects("mistake-approval-boundary", lambda t: t["events"].append({"op": "create_task"}))

    def test_rejects_implementation_before_approval(self):
        self.rejects("mistake-approval-boundary", lambda t: t["events"].append({"op": "implement"}))

    def test_rejects_diagnostic_task_before_report_verification(self):
        self.rejects("mistake-approval-boundary", lambda t: t["events"].__setitem__(slice(0, 3),
            [{"op": "write_report"}, {"op": "create_task"}, {"op": "read_report"}]))

    def test_rejects_partial_completion_claimed_as_success(self):
        self.rejects("partial-reconciliation", lambda t: t["events"].__setitem__(-1,
            answer("Delivery and deal records fully reconciled.")))

    def test_rejects_resend_after_failed_deal_update(self):
        self.rejects("partial-reconciliation", lambda t: t["events"].append({"op": "send"}))

    def test_rejects_duplicate_delivery_milestone(self):
        self.rejects("delivery-replay", lambda t: t["final_pages"].update({
            "deals/example": t["final_pages"]["deals/example"] + " delivery:options"}))

    def test_rejects_replay_regressing_current_state(self):
        self.rejects("delivery-replay", lambda t: t["final_pages"].update({
            "deals/example": "Prepare quote. Timeline event delivery:options."}))


if __name__ == "__main__":
    unittest.main()
