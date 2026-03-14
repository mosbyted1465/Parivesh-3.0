"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getAllStatesWithDistricts } from "india-state-district";
import ProtectedRoute from "../../components/ProtectedRoute";

interface SectorParameter {
  id: string;
  sectorName: string;
  defaultNotes: string;
}

interface LocationHierarchy {
  stateName: string;
  districts: string[];
  state?: string;
  name?: string;
  district?: string[] | string;
  districtList?: string[] | string;
}

interface RequiredDocumentDefinition {
  key: string;
  label: string;
}

interface AffidavitPoint {
  code: string;
  label: string;
}

interface ConditionalComplianceRequirement {
  key: string;
  label: string;
  evidenceKey: string;
  evidenceLabel: string;
}

type StoredDocument = {
  key: string;
  name: string;
  url: string;
  contentType: string;
};

type ExistingApplication = {
  id: string;
  status: "draft" | "eds";
  projectName: string;
  location: string;
  state?: string;
  district?: string;
  description: string;
  category: string;
  sector: string;
  payment?: {
    method?: "upi" | "qr";
    reference?: string;
    status?: "verified" | "pending";
    verifiedAt?: string;
  };
  documents?: StoredDocument[];
  eds?: {
    active?: boolean;
    remarks?: string;
    codes?: string[];
    requestedAt?: string;
    responseNotes?: string;
    respondedAt?: string;
    resubmissionCount?: number;
  };
  affidavits?: {
    acceptedCodes?: string[];
    points?: AffidavitPoint[];
    bundle?: StoredDocument | null;
  };
  conditionalCompliance?: {
    selections?: Record<string, boolean>;
    evidence?: Record<string, StoredDocument | null>;
  };
};

const DEFAULT_REQUIRED_DOCUMENTS: RequiredDocumentDefinition[] = [
  { key: "eiaReport", label: "EIA Report (PDF)" },
  { key: "empPlan", label: "Environment Management Plan - EMP (PDF)" },
  { key: "complianceReport", label: "Compliance Undertaking (PDF)" },
];

const CATEGORY_KEYS = ["A", "B1", "B2"] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

const DEFAULT_CATEGORY_REQUIREMENTS: Record<CategoryKey, RequiredDocumentDefinition[]> = {
  A: DEFAULT_REQUIRED_DOCUMENTS,
  B1: DEFAULT_REQUIRED_DOCUMENTS,
  B2: DEFAULT_REQUIRED_DOCUMENTS,
};

const DEFAULT_AFFIDAVIT_POINTS: AffidavitPoint[] = [
  { code: "NO_OUTSIDE_MINING", label: "No activity outside approved lease/project boundary." },
  { code: "WATER_NO_DISCHARGE", label: "No untreated/polluted discharge into natural water bodies." },
  { code: "PLANTATION_COMMITMENT", label: "Plantation commitment with survival compliance." },
  { code: "DUST_TRANSPORT_CONTROL", label: "Dust suppression and covered transport compliance." },
  { code: "LITIGATION_DECLARATION", label: "Declaration on pending litigation and legal compliance." },
  { code: "SIX_MONTH_REPORTING", label: "Six-monthly compliance reporting commitment." },
];

const DEFAULT_AFFIDAVIT_TEMPLATES: Record<CategoryKey, AffidavitPoint[]> = {
  A: DEFAULT_AFFIDAVIT_POINTS,
  B1: DEFAULT_AFFIDAVIT_POINTS,
  B2: DEFAULT_AFFIDAVIT_POINTS,
};

const DEFAULT_CONDITIONAL_REQUIREMENTS: ConditionalComplianceRequirement[] = [
  {
    key: "nbwlApplicable",
    label: "NBWL clearance is applicable (e.g. protected area proximity).",
    evidenceKey: "nbwlClearance",
    evidenceLabel: "NBWL Clearance Document (PDF)",
  },
  {
    key: "wildlifePlanApplicable",
    label: "Wildlife management / conservation plan is applicable.",
    evidenceKey: "wildlifeManagementPlan",
    evidenceLabel: "Wildlife Management Plan (PDF)",
  },
  {
    key: "forestNocApplicable",
    label: "Forest NOC is applicable for this project.",
    evidenceKey: "forestNoc",
    evidenceLabel: "Forest NOC Document (PDF)",
  },
  {
    key: "waterNocApplicable",
    label: "Water NOC / CGWA permission is applicable.",
    evidenceKey: "waterNoc",
    evidenceLabel: "Water NOC / Permission Document (PDF)",
  },
  {
    key: "droneVideoApplicable",
    label: "Drone survey evidence is applicable.",
    evidenceKey: "droneEvidence",
    evidenceLabel: "Drone Video Compliance Note / Evidence (PDF)",
  },
  {
    key: "kmlApplicable",
    label: "KML/boundary submission is applicable.",
    evidenceKey: "kmlEvidence",
    evidenceLabel: "KML / Boundary Evidence (PDF)",
  },
];

const DEFAULT_SECTOR_OPTIONS = [
  "Mining",
  "Infrastructure",
  "Manufacturing",
  "Power",
  "Oil and Gas",
  "Cement",
  "Chemical",
  "Township and Area Development",
  "Irrigation",
  "Transport",
  "Waste Management",
  "Renewable Energy",
];

const BUILT_IN_LOCATION_FALLBACK: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore"],
  Assam: ["Guwahati", "Dibrugarh", "Silchar", "Nagaon"],
  Bihar: ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur"],
  Chhattisgarh: ["Raipur", "Bilaspur", "Durg", "Bastar"],
  Delhi: ["New Delhi", "Central Delhi", "South Delhi", "North West Delhi"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot"],
  Karnataka: ["Bengaluru Urban", "Mysuru", "Mangaluru", "Belagavi"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik"],
  Odisha: ["Bhubaneswar", "Cuttack", "Puri", "Sambalpur"],
  Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Salem"],
  Telangana: ["Hyderabad", "Warangal", "Nizamabad", "Karimnagar"],
  "Uttar Pradesh": ["Lucknow", "Kanpur Nagar", "Varanasi", "Prayagraj"],
  "West Bengal": ["Kolkata", "Howrah", "Darjeeling", "Siliguri"],
};

const normalizeDistricts = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item, index, arr) => item && arr.indexOf(item) === index)
      .sort((a, b) => a.localeCompare(b));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item, index, arr) => item && arr.indexOf(item) === index)
      .sort((a, b) => a.localeCompare(b));
  }

  return [];
};

const normalizeRequiredDocuments = (value: unknown): RequiredDocumentDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const rows: RequiredDocumentDefinition[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const raw = item as { key?: unknown; label?: unknown };
    const key = String(raw.key || "").trim();
    const label = String(raw.label || "").trim();

    if (!key || !label || seen.has(key)) {
      return;
    }

    seen.add(key);
    rows.push({ key, label });
  });

  return rows;
};

const normalizeAffidavitPoints = (value: unknown): AffidavitPoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const rows: AffidavitPoint[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const raw = item as { code?: unknown; label?: unknown };
    const code = String(raw.code || "").trim();
    const label = String(raw.label || "").trim();

    if (!code || !label || seen.has(code)) {
      return;
    }

    seen.add(code);
    rows.push({ code, label });
  });

  return rows;
};

const createDocumentState = (requirements: RequiredDocumentDefinition[]): Record<string, null> => {
  return requirements.reduce<Record<string, null>>((acc, item) => {
    acc[item.key] = null;
    return acc;
  }, {});
};

const createConditionalSelectionState = (
  requirements: ConditionalComplianceRequirement[]
): Record<string, boolean> => {
  return requirements.reduce<Record<string, boolean>>((acc, item) => {
    acc[item.key] = false;
    return acc;
  }, {});
};

const createConditionalEvidenceState = (
  requirements: ConditionalComplianceRequirement[]
): Record<string, null> => {
  return requirements.reduce<Record<string, null>>((acc, item) => {
    acc[item.evidenceKey] = null;
    return acc;
  }, {});
};

export default function Page() {
  const backendBaseUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  const [projectName, setProjectName] = useState("");
  const [location, setLocation] = useState("");
  const [stateName, setStateName] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("A");
  const [sector, setSector] = useState("");
  const [availableSectors, setAvailableSectors] = useState<SectorParameter[]>([]);
  const [locationHierarchy, setLocationHierarchy] = useState<Record<string, string[]>>({});
  const [categoryRequirements, setCategoryRequirements] = useState<Record<CategoryKey, RequiredDocumentDefinition[]>>(
    DEFAULT_CATEGORY_REQUIREMENTS
  );
  const [affidavitTemplates, setAffidavitTemplates] = useState<Record<CategoryKey, AffidavitPoint[]>>(
    DEFAULT_AFFIDAVIT_TEMPLATES
  );

  const [paymentMethod, setPaymentMethod] = useState<"upi" | "qr">("upi");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [paymentVerifiedAt, setPaymentVerifiedAt] = useState<string | null>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);

  const [documents, setDocuments] = useState<Record<string, File | null>>(createDocumentState(DEFAULT_REQUIRED_DOCUMENTS));
  const [existingDocuments, setExistingDocuments] = useState<Record<string, StoredDocument | null>>(
    createDocumentState(DEFAULT_REQUIRED_DOCUMENTS)
  );

  const [pendingApplications, setPendingApplications] = useState<ExistingApplication[]>([]);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [editingApplicationStatus, setEditingApplicationStatus] = useState<"draft" | "eds" | null>(null);
  const [edsResponseNotes, setEdsResponseNotes] = useState("");
  const [acceptedAffidavitCodes, setAcceptedAffidavitCodes] = useState<string[]>([]);
  const [affidavitBundleFile, setAffidavitBundleFile] = useState<File | null>(null);
  const [existingAffidavitBundle, setExistingAffidavitBundle] = useState<StoredDocument | null>(null);
  const [conditionalRequirements] = useState<ConditionalComplianceRequirement[]>(DEFAULT_CONDITIONAL_REQUIREMENTS);
  const [conditionalSelections, setConditionalSelections] = useState<Record<string, boolean>>(
    createConditionalSelectionState(DEFAULT_CONDITIONAL_REQUIREMENTS)
  );
  const [conditionalEvidenceFiles, setConditionalEvidenceFiles] = useState<Record<string, File | null>>(
    createConditionalEvidenceState(DEFAULT_CONDITIONAL_REQUIREMENTS)
  );
  const [existingConditionalEvidence, setExistingConditionalEvidence] = useState<Record<string, StoredDocument | null>>(
    createConditionalEvidenceState(DEFAULT_CONDITIONAL_REQUIREMENTS)
  );

  const [loading, setLoading] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);

  const selectedEditingApplication = useMemo(
    () => pendingApplications.find((item) => item.id === editingApplicationId) || null,
    [pendingApplications, editingApplicationId]
  );

  const states = useMemo(() => Object.keys(locationHierarchy).sort(), [locationHierarchy]);
  const districts = useMemo(() => {
    if (!stateName) {
      return [] as string[];
    }

    return locationHierarchy[stateName] || [];
  }, [locationHierarchy, stateName]);

  const sectorOptions = useMemo(() => {
    const dynamicOptions = availableSectors.map((item) => item.sectorName.trim()).filter(Boolean);
    const merged = [...dynamicOptions, ...DEFAULT_SECTOR_OPTIONS];
    return merged.filter((item, index, arr) => arr.indexOf(item) === index).sort((a, b) => a.localeCompare(b));
  }, [availableSectors]);

  const isCustomSector = !!sector.trim() && !sectorOptions.includes(sector.trim());
  const activeRequiredDocuments = categoryRequirements[category as CategoryKey] || DEFAULT_REQUIRED_DOCUMENTS;
  const activeAffidavitPoints = affidavitTemplates[category as CategoryKey] || DEFAULT_AFFIDAVIT_POINTS;

  useEffect(() => {
    setDocuments((prev) => {
      const next = { ...prev };
      activeRequiredDocuments.forEach((item) => {
        if (!(item.key in next)) {
          next[item.key] = null;
        }
      });
      return next;
    });

    setExistingDocuments((prev) => {
      const next = { ...prev };
      activeRequiredDocuments.forEach((item) => {
        if (!(item.key in next)) {
          next[item.key] = null;
        }
      });
      return next;
    });
  }, [activeRequiredDocuments]);

  const resetForm = () => {
    const resetRequirements = categoryRequirements.A || DEFAULT_REQUIRED_DOCUMENTS;
    setProjectName("");
    setLocation("");
    setStateName("");
    setDistrictName("");
    setDescription("");
    setCategory("A");
    setSector("");
    setPaymentMethod("upi");
    setPaymentReference("");
    setPaymentVerified(false);
    setPaymentVerifiedAt(null);
    setDocuments(createDocumentState(resetRequirements));
    setExistingDocuments(createDocumentState(resetRequirements));
    setEditingApplicationId(null);
    setEditingApplicationStatus(null);
    setEdsResponseNotes("");
    setAcceptedAffidavitCodes([]);
    setAffidavitBundleFile(null);
    setExistingAffidavitBundle(null);
    setConditionalSelections(createConditionalSelectionState(DEFAULT_CONDITIONAL_REQUIREMENTS));
    setConditionalEvidenceFiles(createConditionalEvidenceState(DEFAULT_CONDITIONAL_REQUIREMENTS));
    setExistingConditionalEvidence(createConditionalEvidenceState(DEFAULT_CONDITIONAL_REQUIREMENTS));
  };

  const getBackendAuthHeaders = async () => {
    const user = auth.currentUser;
    if (!user) {
      return {} as Record<string, string>;
    }

    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  };

  const uploadPdfViaBackend = async (
    ownerId: string,
    docKey: string,
    file: File,
    label: string
  ): Promise<StoredDocument> => {
    if (!backendBaseUrl) {
      throw new Error("BACKEND_UPLOAD_REQUIRED");
    }

    const payload = new FormData();
    payload.append("ownerId", ownerId);
    payload.append("docKey", docKey);
    payload.append("file", file);

    const response = await fetch(`${backendBaseUrl}/api/uploads`, {
      method: "POST",
      headers: await getBackendAuthHeaders(),
      body: payload,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message || `Backend upload failed for ${label}.`);
    }

    const uploaded = (await response.json()) as StoredDocument;
    return {
      key: docKey,
      name: uploaded.name,
      url: uploaded.url,
      contentType: uploaded.contentType || file.type,
    };
  };

  const loadSectors = async () => {
    try {
      if (backendBaseUrl) {
        const response = await fetch(`${backendBaseUrl}/api/sectors`, {
          headers: await getBackendAuthHeaders(),
        });
        if (response.ok) {
          const rows = (await response.json()) as SectorParameter[];
          setAvailableSectors(rows);
          return;
        }
      }

      const snapshot = await getDocs(collection(db, "sectorParameters"));
      const rows = snapshot.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<SectorParameter, "id">),
      }));
      setAvailableSectors(rows);
    } catch (error) {
      console.error("Error loading sector parameters:", error);
    }
  };

  const loadLocationHierarchy = async () => {
    try {
      if (backendBaseUrl) {
        const response = await fetch(`${backendBaseUrl}/api/locations`, {
          headers: await getBackendAuthHeaders(),
        });
        if (response.ok) {
          const rows = (await response.json()) as Array<{ stateName: string; districts: string[] }>;
          const backendMap: Record<string, string[]> = {};
          rows.forEach((row) => {
            const state = String(row.stateName || "").trim();
            const districts = normalizeDistricts(row.districts);
            if (state && districts.length > 0) {
              backendMap[state] = districts;
            }
          });

          if (Object.keys(backendMap).length > 0) {
            setLocationHierarchy(backendMap);
            return;
          }
        }
      }

      const snapshot = await getDocs(collection(db, "locationHierarchy"));
      const map: Record<string, string[]> = {};

      snapshot.docs.forEach((item) => {
        const data = item.data() as LocationHierarchy;
        const currentState = (data.stateName || data.state || data.name || item.id || "").trim();
        if (!currentState) {
          return;
        }

        const currentDistricts = normalizeDistricts(
          data.districts || data.districtList || data.district
        );

        if (currentDistricts.length > 0) {
          map[currentState] = currentDistricts;
        }
      });

      if (Object.keys(map).length === 0) {
        const fallbackRows = getAllStatesWithDistricts() as Array<{
          state?: { name?: string } | string;
          name?: string;
          districts?: string[];
        }>;

        fallbackRows.forEach((row) => {
          const state = String(
            row.name || (typeof row.state === "string" ? row.state : row.state?.name || "")
          ).trim();
          const districts = Array.isArray(row.districts)
            ? row.districts
                .map((item) => String(item).trim())
                .filter((item, index, arr) => item && arr.indexOf(item) === index)
                .sort((a, b) => a.localeCompare(b))
            : [];

          if (state && districts.length > 0) {
            map[state] = districts;
          }
        });
      }

      if (Object.keys(map).length === 0) {
        setLocationHierarchy(BUILT_IN_LOCATION_FALLBACK);
        return;
      }

      setLocationHierarchy(map);
    } catch (error) {
      console.error("Error loading location hierarchy:", error);
      setLocationHierarchy(BUILT_IN_LOCATION_FALLBACK);
    }
  };

  const loadCategoryRequirements = async () => {
    try {
      const snapshot = await getDocs(collection(db, "categoryDocumentRequirements"));
      const map: Record<CategoryKey, RequiredDocumentDefinition[]> = {
        ...DEFAULT_CATEGORY_REQUIREMENTS,
      };

      snapshot.docs.forEach((item) => {
        const data = item.data() as {
          category?: string;
          requiredDocuments?: unknown;
        };

        const categoryName = String(data.category || item.id || "").trim().toUpperCase();
        if (!CATEGORY_KEYS.includes(categoryName as CategoryKey)) {
          return;
        }

        const normalized = normalizeRequiredDocuments(data.requiredDocuments);
        if (normalized.length > 0) {
          map[categoryName as CategoryKey] = normalized;
        }
      });

      setCategoryRequirements(map);
    } catch (error) {
      console.error("Error loading category requirements:", error);
      setCategoryRequirements(DEFAULT_CATEGORY_REQUIREMENTS);
    }
  };

  const loadAffidavitTemplates = async () => {
    try {
      const snapshot = await getDocs(collection(db, "affidavitTemplates"));
      const map: Record<CategoryKey, AffidavitPoint[]> = {
        ...DEFAULT_AFFIDAVIT_TEMPLATES,
      };

      snapshot.docs.forEach((item) => {
        const data = item.data() as {
          category?: string;
          points?: unknown;
        };

        const categoryName = String(data.category || item.id || "").trim().toUpperCase();
        if (!CATEGORY_KEYS.includes(categoryName as CategoryKey)) {
          return;
        }

        const normalized = normalizeAffidavitPoints(data.points);
        if (normalized.length > 0) {
          map[categoryName as CategoryKey] = normalized;
        }
      });

      setAffidavitTemplates(map);
    } catch (error) {
      console.error("Error loading affidavit templates:", error);
      setAffidavitTemplates(DEFAULT_AFFIDAVIT_TEMPLATES);
    }
  };

  const loadPendingApplications = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        return;
      }

      const draftsQuery = query(
        collection(db, "applications"),
        where("ownerId", "==", user.uid),
        where("status", "==", "draft")
      );
      const edsQuery = query(
        collection(db, "applications"),
        where("ownerId", "==", user.uid),
        where("status", "==", "eds")
      );

      const [draftsSnapshot, edsSnapshot] = await Promise.all([
        getDocs(draftsQuery),
        getDocs(edsQuery),
      ]);

      const rows: ExistingApplication[] = [...draftsSnapshot.docs, ...edsSnapshot.docs].map((item) => ({
        id: item.id,
        ...(item.data() as Omit<ExistingApplication, "id">),
      }));

      setPendingApplications(rows);
    } catch (error) {
      console.error("Error loading pending applications:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLocationHierarchy({});
        setPendingApplications([]);
        return;
      }

      loadSectors();
      loadLocationHierarchy();
      loadCategoryRequirements();
      loadAffidavitTemplates();
      loadPendingApplications();
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!stateName) {
      if (districtName) {
        setDistrictName("");
      }
      return;
    }

    if (districtName && !districts.includes(districtName)) {
      setDistrictName("");
    }
  }, [districtName, districts, stateName]);

  const startEditing = (app: ExistingApplication) => {
    const editingCategory = (app.category || "A") as CategoryKey;
    const requirementsForEditing = categoryRequirements[editingCategory] || DEFAULT_REQUIRED_DOCUMENTS;

    setEditingApplicationId(app.id);
    setEditingApplicationStatus(app.status);

    setProjectName(app.projectName || "");
    setLocation(app.location || "");
    setStateName(app.state || "");
    setDistrictName(app.district || "");
    setDescription(app.description || "");
    setCategory(editingCategory);
    setSector(app.sector || "");

    setPaymentMethod(app.payment?.method || "upi");
    setPaymentReference(app.payment?.reference || "");
    setPaymentVerified(app.payment?.status === "verified");
    setPaymentVerifiedAt(app.payment?.verifiedAt || null);

    const docMap = createDocumentState(requirementsForEditing) as Record<string, StoredDocument | null>;

    (app.documents || []).forEach((item) => {
      if (item.key) {
        docMap[item.key] = item;
      }
    });

    setExistingDocuments(docMap);
    setDocuments(createDocumentState(requirementsForEditing));

    setEdsResponseNotes(app.eds?.responseNotes || "");
    setAcceptedAffidavitCodes(
      Array.isArray(app.affidavits?.acceptedCodes)
        ? app.affidavits?.acceptedCodes.map((item) => String(item).trim()).filter(Boolean)
        : []
    );
    setExistingAffidavitBundle(app.affidavits?.bundle || null);
    setAffidavitBundleFile(null);

    const nextSelections = createConditionalSelectionState(conditionalRequirements);
    const storedSelections = app.conditionalCompliance?.selections || {};
    Object.keys(nextSelections).forEach((key) => {
      nextSelections[key] = !!storedSelections[key];
    });
    setConditionalSelections(nextSelections);

    const nextEvidence = createConditionalEvidenceState(conditionalRequirements) as Record<string, StoredDocument | null>;
    const storedEvidence = app.conditionalCompliance?.evidence || {};
    Object.keys(nextEvidence).forEach((key) => {
      const item = storedEvidence[key];
      nextEvidence[key] = item || null;
    });
    setExistingConditionalEvidence(nextEvidence);
    setConditionalEvidenceFiles(createConditionalEvidenceState(conditionalRequirements));
  };

  const handleVerifyPayment = async () => {
    if (!paymentReference.trim()) {
      alert("Enter UPI/QR transaction reference first.");
      return;
    }

    setVerifyingPayment(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const verifiedAt = new Date().toISOString();
    setPaymentVerified(true);
    setPaymentVerifiedAt(verifiedAt);
    setVerifyingPayment(false);
    alert("Payment verified successfully.");
  };

  const saveDraft = async () => {
    if (!projectName.trim() || !location.trim() || !stateName.trim() || !districtName.trim()) {
      alert("Project name, state, district, and location are required to save draft.");
      return;
    }

    setLoading(true);

    try {
      const user = auth.currentUser;

      if (!user) {
        alert("Authentication required. Please log in again.");
        return;
      }

      const draftData = {
        projectName,
        location,
        state: stateName,
        district: districtName,
        description,
        category,
        sector,
        conditionalCompliance: {
          selections: conditionalSelections,
          evidence: existingConditionalEvidence,
        },
        status: "draft",
        ownerId: user.uid,
        ownerEmail: user.email || "",
        updatedAt: serverTimestamp(),
      };

      if (editingApplicationId && editingApplicationStatus === "draft") {
        await updateDoc(doc(db, "applications", editingApplicationId), draftData);
        alert("Draft updated successfully.");
      } else {
        await addDoc(collection(db, "applications"), {
          ...draftData,
          createdAt: serverTimestamp(),
        });
        alert("Draft saved successfully.");
      }

      await loadPendingApplications();
      resetForm();
    } catch (error) {
      console.error("Error saving draft:", error);
      alert("Failed to save draft.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !projectName.trim() ||
      !location.trim() ||
      !stateName.trim() ||
      !districtName.trim() ||
      !description.trim() ||
      !category.trim() ||
      !sector.trim()
    ) {
      alert("Please fill in all fields before submitting.");
      return;
    }

    if (!paymentVerified || !paymentVerifiedAt) {
      alert("Payment verification is required before submission.");
      return;
    }

    if (!backendBaseUrl) {
      alert("Backend upload service is required. Set NEXT_PUBLIC_BACKEND_URL and ensure backend is running.");
      return;
    }

    const missingDocs = activeRequiredDocuments.filter(
      (item) => !documents[item.key] && !existingDocuments[item.key]
    );

    if (missingDocs.length > 0) {
      alert(`Please upload all mandatory documents: ${missingDocs.map((item) => item.label).join(", ")}`);
      return;
    }

    const missingAffidavitDeclarations = activeAffidavitPoints.filter(
      (item) => !acceptedAffidavitCodes.includes(item.code)
    );

    if (missingAffidavitDeclarations.length > 0) {
      alert(`Please accept all affidavit declarations: ${missingAffidavitDeclarations.map((item) => item.code).join(", ")}`);
      return;
    }

    if (!affidavitBundleFile && !existingAffidavitBundle) {
      alert("Please upload notarized affidavit bundle PDF before submission.");
      return;
    }

    const missingConditionalEvidence = conditionalRequirements.filter((item) => {
      if (!conditionalSelections[item.key]) {
        return false;
      }
      return !conditionalEvidenceFiles[item.evidenceKey] && !existingConditionalEvidence[item.evidenceKey];
    });

    if (missingConditionalEvidence.length > 0) {
      alert(
        `Please upload conditional evidence: ${missingConditionalEvidence
          .map((item) => item.evidenceLabel)
          .join(", ")}`
      );
      return;
    }

    setLoading(true);
    setUploadingDocuments(true);

    try {
      const user = auth.currentUser;

      if (!user) {
        alert("Authentication required. Please log in again.");
        setUploadingDocuments(false);
        setLoading(false);
        return;
      }

      const uploadedDocuments = [] as StoredDocument[];
      let savedAffidavitBundle = existingAffidavitBundle;
      const savedConditionalEvidence = {
        ...existingConditionalEvidence,
      } as Record<string, StoredDocument | null>;

      for (const requiredDoc of activeRequiredDocuments) {
        const file = documents[requiredDoc.key];

        if (file) {
          if (file.type !== "application/pdf") {
            alert(`${requiredDoc.label} must be a PDF file.`);
            setUploadingDocuments(false);
            setLoading(false);
            return;
          }

          const maxFileSize = 20 * 1024 * 1024;
          if (file.size > maxFileSize) {
            alert(`${requiredDoc.label} exceeds 20MB size limit.`);
            setUploadingDocuments(false);
            setLoading(false);
            return;
          }

          const uploadedDoc = await uploadPdfViaBackend(
            user.uid,
            requiredDoc.key,
            file,
            requiredDoc.label
          );
          uploadedDocuments.push(uploadedDoc);
        } else {
          const existingDoc = existingDocuments[requiredDoc.key];
          if (existingDoc) {
            uploadedDocuments.push(existingDoc);
          }
        }
      }

      if (affidavitBundleFile) {
        if (affidavitBundleFile.type !== "application/pdf") {
          alert("Affidavit bundle must be a PDF file.");
          setUploadingDocuments(false);
          setLoading(false);
          return;
        }

        const maxFileSize = 20 * 1024 * 1024;
        if (affidavitBundleFile.size > maxFileSize) {
          alert("Affidavit bundle exceeds 20MB size limit.");
          setUploadingDocuments(false);
          setLoading(false);
          return;
        }

        savedAffidavitBundle = await uploadPdfViaBackend(
          user.uid,
          "affidavitBundle",
          affidavitBundleFile,
          "Affidavit Bundle"
        );
      }

      if (savedAffidavitBundle) {
        uploadedDocuments.push(savedAffidavitBundle);
      }

      for (const requirement of conditionalRequirements) {
        if (!conditionalSelections[requirement.key]) {
          savedConditionalEvidence[requirement.evidenceKey] = null;
          continue;
        }

        const file = conditionalEvidenceFiles[requirement.evidenceKey];
        if (file) {
          if (file.type !== "application/pdf") {
            alert(`${requirement.evidenceLabel} must be a PDF file.`);
            setUploadingDocuments(false);
            setLoading(false);
            return;
          }

          const maxFileSize = 20 * 1024 * 1024;
          if (file.size > maxFileSize) {
            alert(`${requirement.evidenceLabel} exceeds 20MB size limit.`);
            setUploadingDocuments(false);
            setLoading(false);
            return;
          }

          savedConditionalEvidence[requirement.evidenceKey] = await uploadPdfViaBackend(
            user.uid,
            requirement.evidenceKey,
            file,
            requirement.evidenceLabel
          );
        }

        if (savedConditionalEvidence[requirement.evidenceKey]) {
          uploadedDocuments.push(savedConditionalEvidence[requirement.evidenceKey] as StoredDocument);
        }
      }

      const baseData = {
        projectName,
        location,
        state: stateName,
        district: districtName,
        description,
        category,
        sector,
        payment: {
          method: paymentMethod,
          reference: paymentReference,
          status: "verified",
          verifiedAt: paymentVerifiedAt,
        },
        documents: uploadedDocuments,
        affidavits: {
          acceptedCodes: acceptedAffidavitCodes,
          points: activeAffidavitPoints,
          bundle: savedAffidavitBundle || null,
        },
        conditionalCompliance: {
          selections: conditionalSelections,
          evidence: savedConditionalEvidence,
        },
        updatedAt: serverTimestamp(),
      };

      let savedApplicationId = editingApplicationId;

      if (editingApplicationId && editingApplicationStatus) {
        const updateData: Record<string, unknown> = {
          ...baseData,
          status: editingApplicationStatus === "eds" ? "under_scrutiny" : "submitted",
        };

        if (editingApplicationStatus === "eds") {
          const existingEds = selectedEditingApplication?.eds || {};
          updateData.eds = {
            ...existingEds,
            active: false,
            responseNotes: edsResponseNotes,
            respondedAt: new Date().toISOString(),
            resubmissionCount: (existingEds.resubmissionCount || 0) + 1,
          };
        }

        await updateDoc(doc(db, "applications", editingApplicationId), updateData);
        alert(editingApplicationStatus === "eds" ? "EDS response submitted for scrutiny." : "Draft submitted successfully.");
      } else {
        const docRef = await addDoc(collection(db, "applications"), {
          ...baseData,
          status: "submitted",
          ownerId: user.uid,
          ownerEmail: user.email || "",
          createdAt: serverTimestamp(),
        });

        savedApplicationId = docRef.id;

        alert(
          `Application submitted successfully! Your Application ID is: ${docRef.id}. You can track your application at /track`
        );
      }

      if (backendBaseUrl && savedApplicationId) {
        try {
          await fetch(`${backendBaseUrl}/api/process-documents`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await getBackendAuthHeaders()),
            },
            body: JSON.stringify({
              applicationId: savedApplicationId,
              ownerId: user.uid,
              documents: uploadedDocuments.map((item) => ({
                  key: item.key,
                url: item.url,
              })),
            }),
          });
        } catch (processingError) {
          console.warn("Backend document processing skipped:", processingError);
        }
      }

      await loadPendingApplications();
      resetForm();
    } catch (error) {
      console.error("Error submitting application:", error);
      const message = String((error as { message?: string })?.message || "");
      if (
        message.toLowerCase().includes("cors")
        || message.toLowerCase().includes("backend_upload_required")
      ) {
        alert("Backend upload service is required. Ensure NEXT_PUBLIC_BACKEND_URL is set and backend server is running.");
      } else if (message.toLowerCase().includes("backend upload failed") || message.toLowerCase().includes("failed to upload file")) {
        alert("File upload failed on backend. Ensure Python backend is running and backend/.env credentials are correct.");
      } else {
        alert("Failed to submit application. Please try again.");
      }
    } finally {
      setUploadingDocuments(false);
      setLoading(false);
    }
  };

  return (
    <ProtectedRoute allowedRole="proponent">
      <main className="container">
        <header className="header">
          <div>
            <h1 className="title">Apply for PARIVESH</h1>
            <p className="subtitle">
              Save drafts, respond to EDS, and submit your complete application with mandatory documents.
            </p>
          </div>
        </header>

        <section className="card" style={{ marginBottom: 16 }}>
          <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>My Pending Actions</h2>
          {pendingApplications.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No draft or EDS applications pending.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {pendingApplications.map((item) => (
                <div key={item.id} className="card" style={{ margin: 0 }}>
                  <p style={{ margin: 0 }}><strong>{item.projectName || "Untitled Project"}</strong></p>
                  <p style={{ margin: "6px 0", color: "var(--muted)" }}>
                    Status: {item.status === "eds" ? "EDS Action Required" : "Draft"}
                  </p>
                  {item.status === "eds" && item.eds?.remarks && (
                    <p style={{ margin: "6px 0", color: "#f0b90b" }}>
                      Scrutiny Remarks: {item.eds.remarks}
                    </p>
                  )}
                  {item.status === "eds" && item.eds?.codes?.length ? (
                    <p style={{ margin: "6px 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                      EDS Codes: {item.eds.codes.join(", ")}
                    </p>
                  ) : null}
                  <button className="button" type="button" onClick={() => startEditing(item)}>
                    {item.status === "eds" ? "Respond to EDS" : "Continue Draft"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Project Name</label>
            <input
              className="input"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Enter project name"
            />
          </div>

          <div className="field">
            <label>Location / Locality</label>
            <input
              className="input"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Enter village/town/locality"
            />
          </div>

          <div className="field">
            <label>State</label>
            <select
              className="select"
              value={stateName}
              onChange={(e) => {
                const nextState = e.target.value;
                setStateName(nextState);
                setDistrictName("");
              }}
            >
              <option value="">Select state</option>
              {states.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>District</label>
            <select
              className="select"
              value={districtName}
              onChange={(e) => setDistrictName(e.target.value)}
              disabled={!stateName}
            >
              <option value="">Select district</option>
              {districts.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Description</label>
            <textarea
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the project details"
              rows={4}
            />
          </div>

          <div className="field">
            <label>Category</label>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="A">A</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
            </select>
          </div>

          <div className="field">
            <label>Sector</label>
            <select
              className="select"
              value={isCustomSector ? "__custom__" : sector}
              onChange={(e) => {
                const selected = e.target.value;
                if (selected === "__custom__") {
                  if (!isCustomSector) {
                    setSector("");
                  }
                  return;
                }
                setSector(selected);
              }}
            >
              <option value="">Select sector</option>
              {sectorOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
              <option value="__custom__">Other (type your sector)</option>
            </select>

            <input
              className="input"
              type="text"
              value={isCustomSector ? sector : ""}
              onChange={(e) => setSector(e.target.value)}
              placeholder="If not listed, type your sector"
              style={{ marginTop: 10 }}
            />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>Mandatory Technical Documents</h2>
            <p style={{ marginBottom: 12, color: "var(--muted)" }}>
              Upload all mandatory documents for category {category} in PDF format (max 20MB each).
            </p>

            {activeRequiredDocuments.map((item) => (
              <div className="field" key={item.key}>
                <label>{item.label}</label>
                <input
                  className="input"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setDocuments((prev) => ({ ...prev, [item.key]: file }));
                  }}
                />
                <p style={{ margin: 0, color: documents[item.key] || existingDocuments[item.key] ? "#2ea043" : "#f0b90b" }}>
                  {documents[item.key]
                    ? `Selected: ${documents[item.key]?.name}`
                    : existingDocuments[item.key]
                    ? `Existing: ${existingDocuments[item.key]?.name}`
                    : "Not uploaded"}
                </p>
                {existingDocuments[item.key]?.url && (
                  <a href={existingDocuments[item.key]?.url || "#"} target="_blank" rel="noreferrer">
                    View existing file
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>Affidavit Declarations</h2>
            <p style={{ marginBottom: 10, color: "var(--muted)" }}>
              Accept all declarations and upload a notarized affidavit bundle PDF.
            </p>

            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {activeAffidavitPoints.map((item) => (
                <label key={item.code} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acceptedAffidavitCodes.includes(item.code)}
                    onChange={(e) => {
                      setAcceptedAffidavitCodes((prev) => {
                        if (e.target.checked) {
                          return [...prev, item.code];
                        }
                        return prev.filter((code) => code !== item.code);
                      });
                    }}
                  />
                  <span>
                    <strong>{item.code}</strong>: {item.label}
                  </span>
                </label>
              ))}
            </div>

            <div className="field">
              <label>Notarized Affidavit Bundle (PDF)</label>
              <input
                className="input"
                type="file"
                accept="application/pdf"
                onChange={(e) => setAffidavitBundleFile(e.target.files?.[0] || null)}
              />
              <p style={{ margin: 0, color: affidavitBundleFile || existingAffidavitBundle ? "#2ea043" : "#f0b90b" }}>
                {affidavitBundleFile
                  ? `Selected: ${affidavitBundleFile.name}`
                  : existingAffidavitBundle
                  ? `Existing: ${existingAffidavitBundle.name}`
                  : "Not uploaded"}
              </p>
              {existingAffidavitBundle?.url && (
                <a href={existingAffidavitBundle.url} target="_blank" rel="noreferrer">
                  View existing affidavit bundle
                </a>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>Conditional Regulatory Evidence</h2>
            <p style={{ marginBottom: 10, color: "var(--muted)" }}>
              Mark each item as applicable where relevant. If selected, the corresponding evidence PDF is mandatory.
            </p>

            {conditionalRequirements.map((item) => (
              <div key={item.key} className="card" style={{ marginTop: 10 }}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!conditionalSelections[item.key]}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setConditionalSelections((prev) => ({
                        ...prev,
                        [item.key]: checked,
                      }));

                      if (!checked) {
                        setConditionalEvidenceFiles((prev) => ({
                          ...prev,
                          [item.evidenceKey]: null,
                        }));
                      }
                    }}
                  />
                  <span>{item.label}</span>
                </label>

                {conditionalSelections[item.key] && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>{item.evidenceLabel}</label>
                    <input
                      className="input"
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setConditionalEvidenceFiles((prev) => ({
                          ...prev,
                          [item.evidenceKey]: file,
                        }));
                      }}
                    />
                    <p
                      style={{
                        margin: 0,
                        color:
                          conditionalEvidenceFiles[item.evidenceKey] || existingConditionalEvidence[item.evidenceKey]
                            ? "#2ea043"
                            : "#f0b90b",
                      }}
                    >
                      {conditionalEvidenceFiles[item.evidenceKey]
                        ? `Selected: ${conditionalEvidenceFiles[item.evidenceKey]?.name}`
                        : existingConditionalEvidence[item.evidenceKey]
                        ? `Existing: ${existingConditionalEvidence[item.evidenceKey]?.name}`
                        : "Not uploaded"}
                    </p>
                    {existingConditionalEvidence[item.evidenceKey]?.url && (
                      <a href={existingConditionalEvidence[item.evidenceKey]?.url || "#"} target="_blank" rel="noreferrer">
                        View existing evidence
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>Fee Payment (Simulation)</h2>
            <div className="field">
              <label>Payment Method</label>
              <select
                className="select"
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value as "upi" | "qr");
                  setPaymentVerified(false);
                  setPaymentVerifiedAt(null);
                }}
              >
                <option value="upi">UPI</option>
                <option value="qr">QR Code</option>
              </select>
            </div>

            <div className="field">
              <label>Transaction Reference</label>
              <input
                className="input"
                type="text"
                value={paymentReference}
                onChange={(e) => {
                  setPaymentReference(e.target.value);
                  setPaymentVerified(false);
                  setPaymentVerifiedAt(null);
                }}
                placeholder={paymentMethod === "upi" ? "Enter UPI transaction ID" : "Enter QR payment ref"}
              />
            </div>

            <button className="button" type="button" onClick={handleVerifyPayment} disabled={verifyingPayment}>
              {verifyingPayment ? "Verifying..." : "Verify Payment"}
            </button>

            <p style={{ marginTop: 10, color: paymentVerified ? "#2ea043" : "#f0b90b" }}>
              Payment Status: {paymentVerified ? "Verified" : "Pending Verification"}
            </p>
          </div>

          {editingApplicationStatus === "eds" && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2 className="text-lg font-semibold" style={{ marginTop: 0 }}>EDS Response</h2>
              {selectedEditingApplication?.eds?.codes?.length ? (
                <div className="field">
                  <label>EDS Selected Codes</label>
                  <p style={{ margin: 0, color: "#f0b90b" }}>
                    {selectedEditingApplication.eds.codes.join(", ")}
                  </p>
                </div>
              ) : null}
              {selectedEditingApplication?.eds?.remarks ? (
                <div className="field">
                  <label>Scrutiny Remarks</label>
                  <p style={{ margin: 0, color: "#f0b90b" }}>
                    {selectedEditingApplication.eds.remarks}
                  </p>
                </div>
              ) : null}
              <div className="field">
                <label>Response Notes for Scrutiny Team</label>
                <textarea
                  className="textarea"
                  rows={4}
                  value={edsResponseNotes}
                  onChange={(e) => setEdsResponseNotes(e.target.value)}
                  placeholder="Describe the corrections made against EDS remarks"
                />
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {editingApplicationStatus !== "eds" && (
              <button className="button button-secondary" type="button" disabled={loading} onClick={saveDraft}>
                {loading ? "Saving..." : "Save Draft"}
              </button>
            )}

            <button className="button" type="submit" disabled={loading}>
              {loading
                ? uploadingDocuments
                  ? "Uploading documents..."
                  : "Submitting..."
                : editingApplicationStatus === "eds"
                ? "Resubmit to Scrutiny"
                : editingApplicationStatus === "draft"
                ? "Submit Draft"
                : "Submit Application"}
            </button>

            {(editingApplicationId || editingApplicationStatus) && (
              <button className="button button-secondary" type="button" onClick={resetForm}>
                Cancel Editing
              </button>
            )}
          </div>
        </form>
      </main>
    </ProtectedRoute>
  );
}
