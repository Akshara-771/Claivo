from rag_pipeline import load_vector_store

def test_db():
    db = load_vector_store()
    
    print("==== RAG PIPELINE FILTER TEST ====")
    docs = db.similarity_search("Section 3 accommodation tables and limits for G5", k=4, filter={"category": "accommodation"})
    for i, d in enumerate(docs):
        print(f"--- RAG DOC {i} ---")
        print("Metadata:", d.metadata)
        print("Content:", d.page_content[:200].replace('\n', ' '))

    print("\n==== GET POLICY LIMIT TEST ====")
    docs2 = db.similarity_search("What is the maximum nightly USD limit for G5 in accommodation?", k=1)
    for i, d in enumerate(docs2):
        print(f"--- POLICY DOC {i} ---")
        print("Metadata:", d.metadata)
        print("Content:", d.page_content[:200].replace('\n', ' '))

if __name__ == "__main__":
    test_db()
