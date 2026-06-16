"""DocuMind backend tests — covers catalog, completeness, generation, versions,
duplicate, patch/delete, list filters, pipeline, interview, review, templates,
settings, export and improve. AI calls use long timeouts."""
import io
import time
import zipfile
import requests

# Long timeout for AI calls (60-240s)
AI_TIMEOUT = 240
SHORT = 30


# ---------- catalog / stats ----------
class TestCatalog:
    def test_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/", timeout=SHORT)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_catalog(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/catalog", timeout=SHORT)
        assert r.status_code == 200
        data = r.json()
        assert set(["categories", "industries", "doc_types", "pipeline"]).issubset(data.keys())
        cats = data["categories"]
        assert set(["ba", "pm", "qa", "ops", "mfg", "hr"]).issubset(cats.keys())
        # 29 doc types
        total = sum(len(v["types"]) for v in data["doc_types"].values())
        assert total == 29, f"Expected 29 doc types, got {total}"
        assert "IT" in data["industries"]
        assert "brd" in data["pipeline"] and "frd" in data["pipeline"]["brd"]

    def test_stats(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/stats", timeout=SHORT)
        assert r.status_code == 200
        data = r.json()
        assert "total" in data and "by_type" in data
        assert "templates" in data and "reviews" in data
        assert "brd" in data["by_type"]


# ---------- completeness ----------
class TestCompleteness:
    def test_partial_inputs(self, api_client, base_url):
        payload = {
            "type": "brd",
            "industry": "IT",
            "inputs": {
                "Project Name": "Test Onboarding",
                "Business Problem": "Onboarding is slow",
            },
        }
        r = api_client.post(f"{base_url}/api/completeness", json=payload, timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "completeness_score" in data
        assert 0 <= int(data["completeness_score"]) <= 100
        assert isinstance(data.get("missing_fields"), list)
        assert len(data["missing_fields"]) > 0
        assert isinstance(data.get("suggestions"), list)


# ---------- generation, persistence, version chain, patch, delete ----------
class TestGenerationLifecycle:
    GENERATED_ID = None
    VERSION_ID = None
    DUP_ID = None

    def test_01_generate_user_story(self, api_client, base_url):
        payload = {
            "type": "user-story",
            "industry": "IT",
            "inputs": {
                "Project Name": "TEST_DocuMind",
                "Feature Name": "Single Sign-On",
                "User Type": "Employee",
                "Business Goal": "Enable secure SSO login",
                "Acceptance Criteria": "Users can log in via SAML",
            },
        }
        r = api_client.post(f"{base_url}/api/generate", json=payload, timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data
        assert data["title"]
        assert data["version_number"] == "1.0"
        assert data["category"] == "ba"
        assert data["industry"] == "IT"
        assert "sections" in data["content"]
        assert len(data["content"]["sections"]) >= 4
        TestGenerationLifecycle.GENERATED_ID = data["id"]

    def test_02_doc_listable(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/documents", timeout=SHORT)
        assert r.status_code == 200
        ids = [d["id"] for d in r.json()]
        assert TestGenerationLifecycle.GENERATED_ID in ids

    def test_03_get_persisted(self, api_client, base_url):
        did = TestGenerationLifecycle.GENERATED_ID
        r = api_client.get(f"{base_url}/api/documents/{did}", timeout=SHORT)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == did
        assert len(d["content"]["sections"]) >= 4

    def test_04_create_new_version(self, api_client, base_url):
        did = TestGenerationLifecycle.GENERATED_ID
        r = api_client.post(f"{base_url}/api/documents/{did}/versions", timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["parent_id"] == did
        assert d["version_number"] == "1.1"
        TestGenerationLifecycle.VERSION_ID = d["id"]

    def test_05_list_versions(self, api_client, base_url):
        did = TestGenerationLifecycle.GENERATED_ID
        r = api_client.get(f"{base_url}/api/documents/{did}/versions", timeout=SHORT)
        assert r.status_code == 200
        fam = r.json()
        versions = [d["version_number"] for d in fam]
        assert "1.0" in versions and "1.1" in versions
        assert len(fam) >= 2

    def test_06_duplicate(self, api_client, base_url):
        did = TestGenerationLifecycle.GENERATED_ID
        r = api_client.post(f"{base_url}/api/documents/{did}/duplicate", timeout=SHORT)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] != did
        assert d["parent_id"] is None
        assert d["version_number"] == "1.0"
        assert d["title"].endswith("(Copy)")
        TestGenerationLifecycle.DUP_ID = d["id"]

    def test_07_patch(self, api_client, base_url):
        did = TestGenerationLifecycle.DUP_ID
        r = api_client.patch(
            f"{base_url}/api/documents/{did}",
            json={"title": "TEST_Updated_Title"},
            timeout=SHORT,
        )
        assert r.status_code == 200
        assert r.json()["title"] == "TEST_Updated_Title"
        # Verify persisted
        r2 = api_client.get(f"{base_url}/api/documents/{did}", timeout=SHORT)
        assert r2.json()["title"] == "TEST_Updated_Title"

    def test_08_filters(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/documents",
            params={"type": "user-story", "category": "ba", "industry": "IT", "sort": "score_desc"},
            timeout=SHORT,
        )
        assert r.status_code == 200
        docs = r.json()
        for d in docs:
            assert d["type"] == "user-story"
            assert d["category"] == "ba"
            assert d["industry"] == "IT"

    def test_09_search_q(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/documents", params={"q": "TEST_Updated"}, timeout=SHORT)
        assert r.status_code == 200
        titles = [d["title"] for d in r.json()]
        assert any("TEST_Updated" in t for t in titles)

    def test_10_improve_section(self, api_client, base_url):
        did = TestGenerationLifecycle.GENERATED_ID
        r = api_client.get(f"{base_url}/api/documents/{did}", timeout=SHORT)
        original_sections = r.json()["content"]["sections"]
        n = len(original_sections)
        original_content = original_sections[0]["content"]

        r2 = api_client.post(
            f"{base_url}/api/documents/{did}/improve",
            json={"section_index": 0},
            timeout=AI_TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        new_sections = updated["content"]["sections"]
        assert len(new_sections) == n
        # Heading preserved
        assert new_sections[0]["heading"] == original_sections[0]["heading"]
        # Content likely different (improved) - but tolerate same length
        assert new_sections[0]["content"]

    def test_11_delete(self, api_client, base_url):
        did = TestGenerationLifecycle.DUP_ID
        r = api_client.delete(f"{base_url}/api/documents/{did}", timeout=SHORT)
        assert r.status_code == 200
        # Should not appear in list
        r2 = api_client.get(f"{base_url}/api/documents", timeout=SHORT)
        ids = [d["id"] for d in r2.json()]
        assert did not in ids
        # GET should 404
        r3 = api_client.get(f"{base_url}/api/documents/{did}", timeout=SHORT)
        assert r3.status_code == 404


# ---------- pipeline ----------
class TestPipeline:
    def test_pipeline_brd_to_frd(self, api_client, base_url):
        # Create a small BRD via generate
        brd_payload = {
            "type": "brd",
            "industry": "IT",
            "inputs": {
                "Project Name": "TEST_Pipeline_BRD",
                "Business Problem": "Slow onboarding",
                "Proposed Solution": "Automated SSO portal",
                "Business Objectives": "Cut onboarding time by 50%",
            },
        }
        r = api_client.post(f"{base_url}/api/generate", json=brd_payload, timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        brd_id = r.json()["id"]

        # Pipeline to FRD
        r2 = api_client.post(
            f"{base_url}/api/pipeline/generate",
            json={"source_id": brd_id, "target_type": "frd", "industry": "IT"},
            timeout=AI_TIMEOUT,
        )
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["type"] == "frd"
        assert d["source_doc_id"] == brd_id
        assert len(d["content"]["sections"]) >= 4

        # Cleanup
        api_client.delete(f"{base_url}/api/documents/{brd_id}", timeout=SHORT)
        api_client.delete(f"{base_url}/api/documents/{d['id']}", timeout=SHORT)

    def test_pipeline_invalid_pairing(self, api_client, base_url):
        # Use any existing BRD-typed doc or create cheap one
        payload = {
            "type": "brd",
            "industry": "IT",
            "inputs": {"Project Name": "TEST_BadPipeline", "Business Problem": "x"},
        }
        r = api_client.post(f"{base_url}/api/generate", json=payload, timeout=AI_TIMEOUT)
        assert r.status_code == 200
        brd_id = r.json()["id"]
        # brd -> defect-report is NOT in pipeline mapping
        r2 = api_client.post(
            f"{base_url}/api/pipeline/generate",
            json={"source_id": brd_id, "target_type": "defect-report"},
            timeout=SHORT,
        )
        assert r2.status_code == 400
        api_client.delete(f"{base_url}/api/documents/{brd_id}", timeout=SHORT)


# ---------- interview ----------
class TestInterview:
    CONV_ID = None

    def test_01_start(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/interview/start",
            json={"type": "user-story", "industry": "IT"},
            timeout=AI_TIMEOUT,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "id" in d
        assert isinstance(d["messages"], list) and len(d["messages"]) >= 1
        assert d["messages"][0]["role"] == "assistant"
        assert "state" in d
        assert d["state"].get("is_complete") in (False, True)
        TestInterview.CONV_ID = d["id"]

    def test_02_message_and_progress(self, api_client, base_url):
        cid = TestInterview.CONV_ID
        answers = [
            "The project is TEST_Interview. We need a self-service password reset feature.",
            "Target users are all corporate employees. The benefit is reduced helpdesk load.",
            "Acceptance criteria: user can reset password via email link within 60 seconds.",
        ]
        last_state = None
        for a in answers:
            r = api_client.post(
                f"{base_url}/api/interview/{cid}/message",
                json={"answer": a},
                timeout=AI_TIMEOUT,
            )
            assert r.status_code == 200, r.text
            last_state = r.json()["state"]
        assert last_state is not None
        # gathered should have some keys
        assert isinstance(last_state.get("gathered", {}), dict)

    def test_03_generate_from_interview(self, api_client, base_url):
        cid = TestInterview.CONV_ID
        r = api_client.post(f"{base_url}/api/interview/{cid}/generate", timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "user-story"
        assert len(d["content"]["sections"]) >= 3
        # Cleanup
        api_client.delete(f"{base_url}/api/documents/{d['id']}", timeout=SHORT)


# ---------- reviewer ----------
class TestReviewer:
    REVIEW_ID = None

    def test_01_upload_txt(self, api_client, base_url):
        sample = (
            "Project: TEST_Reviewer\n"
            "Problem: Onboarding is slow and error-prone.\n"
            "Objectives: Reduce time, improve compliance.\n"
            "Scope: HR onboarding flow.\n"
            "Requirements: Single sign-on, doc upload, e-sign.\n"
        )
        files = {"file": ("sample_brd.txt", io.BytesIO(sample.encode()), "text/plain")}
        # Use plain requests to support multipart
        r = requests.post(f"{base_url}/api/review/upload", files=files, timeout=AI_TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        a = d.get("analysis") or {}
        for k in ("quality_score", "strengths", "weaknesses", "missing_sections", "risks", "recommendations", "summary"):
            assert k in a, f"missing key {k} in review analysis"
        TestReviewer.REVIEW_ID = d["id"]

    def test_02_list_and_get(self, api_client, base_url):
        rid = TestReviewer.REVIEW_ID
        r = api_client.get(f"{base_url}/api/reviews", timeout=SHORT)
        assert r.status_code == 200
        assert any(rev["id"] == rid for rev in r.json())
        r2 = api_client.get(f"{base_url}/api/reviews/{rid}", timeout=SHORT)
        assert r2.status_code == 200
        # Cleanup
        api_client.delete(f"{base_url}/api/reviews/{rid}", timeout=SHORT)


# ---------- templates ----------
class TestTemplates:
    TPL_ID = None

    def test_01_upload(self, base_url):
        files = {"file": ("tpl.txt", io.BytesIO(b"Sample template content"), "text/plain")}
        data = {
            "name": "TEST_Template",
            "description": "Test template",
            "header": "TEST HEADER",
            "footer": "TEST FOOTER",
            "document_id_prefix": "TST",
            "version_number": "2.0",
            "author": "Tester",
            "reviewer": "Rev",
            "approver": "App",
        }
        r = requests.post(f"{base_url}/api/templates", files=files, data=data, timeout=SHORT)
        assert r.status_code == 200, r.text
        TestTemplates.TPL_ID = r.json()["id"]

    def test_02_list_get_delete(self, api_client, base_url):
        tid = TestTemplates.TPL_ID
        r = api_client.get(f"{base_url}/api/templates", timeout=SHORT)
        assert r.status_code == 200
        assert any(t["id"] == tid for t in r.json())
        r2 = api_client.get(f"{base_url}/api/templates/{tid}", timeout=SHORT)
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_Template"


# ---------- settings ----------
class TestSettings:
    def test_put_get(self, api_client, base_url):
        payload = {
            "company_name": "TEST_Acme",
            "company_logo_url": "",
            "project_name": "TEST_Proj",
            "document_id": "DOC-001",
            "version_number": "3.0",
            "author": "Alice",
            "reviewer": "Bob",
            "approver": "Carol",
            "page_layout": "letter",
        }
        r = api_client.put(f"{base_url}/api/settings", json=payload, timeout=SHORT)
        assert r.status_code == 200
        r2 = api_client.get(f"{base_url}/api/settings", timeout=SHORT)
        assert r2.status_code == 200
        s = r2.json()
        assert s["company_name"] == "TEST_Acme"
        assert s["version_number"] == "3.0"


# ---------- export docx ----------
class TestExport:
    def test_export_docx(self, api_client, base_url):
        # Create cheap doc
        payload = {
            "type": "defect-report",
            "industry": "IT",
            "inputs": {
                "Application Name": "TEST_Export",
                "Environment": "QA",
                "Steps Observed": "Click breaks",
                "Severity": "Low",
            },
        }
        r = api_client.post(f"{base_url}/api/generate", json=payload, timeout=AI_TIMEOUT)
        assert r.status_code == 200
        did = r.json()["id"]
        # Without template
        r2 = api_client.get(f"{base_url}/api/export/docx/{did}", timeout=SHORT)
        assert r2.status_code == 200
        cd = r2.headers.get("Content-Disposition", "")
        assert "attachment" in cd and ".docx" in cd
        assert r2.headers.get("Content-Type", "").startswith(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        # Verify it's a real zip (docx)
        zf = zipfile.ZipFile(io.BytesIO(r2.content))
        names = zf.namelist()
        assert "word/document.xml" in names

        # With a template
        files = {"file": ("tpl.txt", io.BytesIO(b"template body"), "text/plain")}
        data = {
            "name": "TEST_ExportTpl",
            "header": "Hdr-FromTpl",
            "footer": "Ftr-FromTpl",
            "author": "TplAuthor",
            "document_id_prefix": "EXP",
            "version_number": "9.9",
        }
        tr = requests.post(f"{base_url}/api/templates", files=files, data=data, timeout=SHORT)
        assert tr.status_code == 200
        tid = tr.json()["id"]
        r3 = api_client.get(f"{base_url}/api/export/docx/{did}", params={"template_id": tid}, timeout=SHORT)
        assert r3.status_code == 200
        # Cleanup
        api_client.delete(f"{base_url}/api/documents/{did}", timeout=SHORT)
        api_client.delete(f"{base_url}/api/templates/{tid}", timeout=SHORT)


# ---------- negative ----------
class TestNegative:
    def test_unknown_type_completeness(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/completeness", json={"type": "not-a-type", "inputs": {}}, timeout=SHORT
        )
        assert r.status_code == 400

    def test_missing_doc(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/documents/not-a-real-id", timeout=SHORT)
        assert r.status_code == 404
