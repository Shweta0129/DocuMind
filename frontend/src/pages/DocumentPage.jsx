import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import DocumentViewer from "../components/DocumentViewer";
import QualityScore from "../components/QualityScore";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function DocumentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.getDocument(id);
        setDoc(d);
      } catch {
        toast.error("Document not found");
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="px-5 md:px-10 py-10 max-w-7xl mx-auto">
        <div className="h-10 w-1/3 rounded-md shimmer mb-4" />
        <div className="h-60 rounded-xl shimmer" />
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="px-5 md:px-10 py-10 max-w-7xl mx-auto">
        <p>Document not found.</p>
        <button className="nb-btn mt-4" onClick={() => navigate("/")}>Back to dashboard</button>
      </div>
    );
  }

  const onUpdate = async (patch) => {
    const updated = await api.updateDocument(doc.id, patch);
    setDoc(updated);
  };

  return (
    <div className="px-5 md:px-10 py-8 md:py-10 max-w-7xl mx-auto" data-testid="document-page">
      <button
        onClick={() => navigate(-1)}
        className="nb-btn nb-btn-ghost mb-6"
        data-testid="back-from-document"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 lg:order-2">
          <QualityScore score={doc.completeness_score} suggestions={doc.suggestions} />
        </div>
        <div className="lg:col-span-3 lg:order-1">
          <DocumentViewer
            doc={doc}
            onUpdate={onUpdate}
            onAfterAction={(d) => setDoc(d)}
          />
        </div>
      </div>
    </div>
  );
}
