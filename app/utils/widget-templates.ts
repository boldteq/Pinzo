export interface WidgetTemplate {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  successColor: string;
  errorColor: string;
  backgroundColor: string;
  textColor: string;
  borderRadius: string;
}

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  {
    id: "default",
    name: "Default",
    description: "Clean Shopify green",
    primaryColor: "#008060",
    successColor: "#008060",
    errorColor: "#D72C0D",
    backgroundColor: "#FFFFFF",
    textColor: "#202223",
    borderRadius: "8",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Dark, vibrant accents",
    primaryColor: "#6366F1",
    successColor: "#10B981",
    errorColor: "#EF4444",
    backgroundColor: "#1E1E2E",
    textColor: "#F8F8F2",
    borderRadius: "12",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Monochrome, clean",
    primaryColor: "#111111",
    successColor: "#111111",
    errorColor: "#666666",
    backgroundColor: "#FAFAFA",
    textColor: "#111111",
    borderRadius: "4",
  },
  {
    id: "bold",
    name: "Bold",
    description: "High contrast, max impact",
    primaryColor: "#FF6B35",
    successColor: "#00C851",
    errorColor: "#FF3547",
    backgroundColor: "#FFFFFF",
    textColor: "#212121",
    borderRadius: "0",
  },
  {
    id: "soft",
    name: "Soft",
    description: "Pastel, friendly feel",
    primaryColor: "#7C9CBF",
    successColor: "#81C784",
    errorColor: "#E57373",
    backgroundColor: "#F5F7FA",
    textColor: "#445566",
    borderRadius: "16",
  },
];
