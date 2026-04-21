"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Locale = "en" | "nl";

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Sidebar
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.products": "Products",
    "nav.brands": "Brands",
    "nav.categories": "Categories",
    "nav.search": "Product Search",
    "nav.kenteken": "License Plate Lookup",
    "nav.cart": "Cart",
    "nav.orders": "Orders",
    "nav.tecdoc": "TecDoc",
    "nav.unmatched": "Unmatched",
    "nav.tasks": "Tasks & Bugs",
    "nav.finalized": "Finalized Products",
    "nav.analytics": "Analytics",
    "nav.storage": "Storage",
    "nav.overrides": "Overrides",
    "nav.settings": "Settings",
    "nav.workflow": "Workflow",
    "nav.health": "System Health",
    "nav.apiReference": "API Reference",
    "nav.toggleTheme": "Toggle theme",

    // Settings
    "settings.title": "Pricing Settings",
    "settings.subtitle": "Configure tax rate, margin, and pricing for the storefront",
    "settings.taxRate": "Tax Rate (BTW)",
    "settings.taxRateDesc": "VAT percentage applied to all product prices",
    "settings.marginPercentage": "Margin Percentage",
    "settings.marginDesc": "Markup percentage added to supplier purchase price",
    "settings.currency": "Currency",
    "settings.saveSettings": "Save Settings",
    "settings.saved": "Settings saved successfully",
    "settings.preview": "Pricing Preview",
    "settings.previewDesc": "See how current settings affect product prices",
    "settings.basePrice": "Base Price",
    "settings.withMargin": "With Margin",
    "settings.withTax": "With Tax (Final)",
    "settings.formula": "Final Price = Base Price x (1 + Margin%) x (1 + Tax%)",

    // Common
    "common.search": "Search",
    "common.clear": "Clear",
    "common.loading": "Loading...",
    "common.noResults": "No results found",
    "common.previous": "Previous",
    "common.next": "Next",
    "common.page": "Page",
    "common.of": "of",
    "common.showing": "Showing",
    "common.total": "Total",
    "common.all": "All",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.close": "Close",
    "common.yes": "Yes",
    "common.no": "No",
    "common.active": "Active",
    "common.inactive": "Inactive",

    // Filters
    "filter.allBrands": "All Brands",
    "filter.allCategories": "All Categories",
    "filter.allSuppliers": "All Suppliers",
    "filter.stock": "Stock",
    "filter.anyStock": "Any Stock",
    "filter.inStock": "In Stock",
    "filter.outOfStock": "Out of Stock",
    "filter.price": "Price",
    "filter.anyPrice": "Any Price",
    "filter.hasPrice": "Has Price",
    "filter.noPrice": "No Price",
    "filter.image": "Image",
    "filter.anyImage": "Any Image",
    "filter.hasImage": "Has Image",
    "filter.noImage": "No Image",

    // Finalized
    "finalized.title": "Finalized Products",
    "finalized.subtitle": "Complete product catalog with pricing, stock, and InterCars mapping data",
    "finalized.total": "Total",
    "finalized.withPrice": "With Price",
    "finalized.inStock": "In Stock",
    "finalized.withImage": "With Image",
    "finalized.icMapped": "IC Mapped",
    "finalized.searchPlaceholder": "Search by article, SKU, EAN, OEM, description...",
    "finalized.products": "Products",
    "finalized.topBrands": "Top Brands",
    "finalized.productDetails": "Product Details",
    "finalized.articleNo": "Article No",
    "finalized.brand": "Brand",
    "finalized.description": "Description",
    "finalized.stock": "Stock",
    "finalized.icCode": "IC Code",
    "finalized.supplier": "Supplier",
    "finalized.sku": "SKU",
    "finalized.ean": "EAN",
    "finalized.tecdocId": "TecDoc ID",
    "finalized.category": "Category",
    "finalized.genericArticle": "Generic Article",
    "finalized.status": "Status",
    "finalized.updated": "Updated",
    "finalized.created": "Created",
    "finalized.weight": "Weight",
    "finalized.oemNumbers": "OEM Numbers",
    "finalized.images": "Images",
    "finalized.icMapping": "InterCars Mapping",
    "finalized.towCode": "TOW Code",
    "finalized.icIndex": "IC Index",
    "finalized.manufacturer": "Manufacturer",
    "finalized.notSet": "Not set",

    // Dashboard home
    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Multi-supplier automotive parts management",
    "dashboard.totalProducts": "Total Products",
    "dashboard.activeSuppliers": "Active Suppliers",
    "dashboard.matchRate": "Match Rate",
    "dashboard.recentActivity": "Recent Activity",

    // Products
    "products.title": "Products",
    "products.subtitle": "Manage product catalog across all suppliers",

    // Brands
    "brands.title": "Brands",
    "brands.subtitle": "Manage automotive part manufacturers",

    // Categories
    "categories.title": "Categories",
    "categories.subtitle": "Product categories from TecDoc",

    // Suppliers
    "suppliers.title": "Suppliers",
    "suppliers.subtitle": "Manage connected part suppliers",

    // Health
    "health.title": "System Health",
    "health.subtitle": "Monitor system status and service health",
  },
  nl: {
    // Sidebar
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Leveranciers",
    "nav.products": "Producten",
    "nav.brands": "Merken",
    "nav.categories": "Categorieën",
    "nav.search": "Producten zoeken",
    "nav.kenteken": "Kenteken zoeker",
    "nav.cart": "Winkelwagen",
    "nav.orders": "Bestellingen",
    "nav.tecdoc": "TecDoc",
    "nav.unmatched": "Niet gekoppeld",
    "nav.tasks": "Taken & Bugs",
    "nav.finalized": "Eindproducten",
    "nav.analytics": "Analyse",
    "nav.storage": "Opslag",
    "nav.overrides": "Overschrijvingen",
    "nav.settings": "Instellingen",
    "nav.workflow": "Workflow",
    "nav.health": "Systeemstatus",
    "nav.apiReference": "API Referentie",
    "nav.toggleTheme": "Thema wisselen",

    // Settings
    "settings.title": "Prijsinstellingen",
    "settings.subtitle": "Configureer BTW-tarief, marge en prijzen voor de webshop",
    "settings.taxRate": "BTW-tarief",
    "settings.taxRateDesc": "BTW-percentage toegepast op alle productprijzen",
    "settings.marginPercentage": "Marge percentage",
    "settings.marginDesc": "Opslag percentage op de inkoopprijs van de leverancier",
    "settings.currency": "Valuta",
    "settings.saveSettings": "Instellingen opslaan",
    "settings.saved": "Instellingen succesvol opgeslagen",
    "settings.preview": "Prijsvoorbeeld",
    "settings.previewDesc": "Bekijk hoe de huidige instellingen de productprijzen beïnvloeden",
    "settings.basePrice": "Inkoopprijs",
    "settings.withMargin": "Met marge",
    "settings.withTax": "Met BTW (Eindprijs)",
    "settings.formula": "Eindprijs = Inkoopprijs x (1 + Marge%) x (1 + BTW%)",

    // Common
    "common.search": "Zoeken",
    "common.clear": "Wissen",
    "common.loading": "Laden...",
    "common.noResults": "Geen resultaten gevonden",
    "common.previous": "Vorige",
    "common.next": "Volgende",
    "common.page": "Pagina",
    "common.of": "van",
    "common.showing": "Toont",
    "common.total": "Totaal",
    "common.all": "Alle",
    "common.save": "Opslaan",
    "common.cancel": "Annuleren",
    "common.edit": "Bewerken",
    "common.delete": "Verwijderen",
    "common.close": "Sluiten",
    "common.yes": "Ja",
    "common.no": "Nee",
    "common.active": "Actief",
    "common.inactive": "Inactief",

    // Filters
    "filter.allBrands": "Alle Merken",
    "filter.allCategories": "Alle Categorieën",
    "filter.allSuppliers": "Alle Leveranciers",
    "filter.stock": "Voorraad",
    "filter.anyStock": "Alle Voorraad",
    "filter.inStock": "Op voorraad",
    "filter.outOfStock": "Niet op voorraad",
    "filter.price": "Prijs",
    "filter.anyPrice": "Alle Prijzen",
    "filter.hasPrice": "Met prijs",
    "filter.noPrice": "Zonder prijs",
    "filter.image": "Afbeelding",
    "filter.anyImage": "Alle Afbeeldingen",
    "filter.hasImage": "Met afbeelding",
    "filter.noImage": "Zonder afbeelding",

    // Finalized
    "finalized.title": "Eindproducten",
    "finalized.subtitle": "Volledige productcatalogus met prijzen, voorraad en InterCars koppeling",
    "finalized.total": "Totaal",
    "finalized.withPrice": "Met prijs",
    "finalized.inStock": "Op voorraad",
    "finalized.withImage": "Met afbeelding",
    "finalized.icMapped": "IC Gekoppeld",
    "finalized.searchPlaceholder": "Zoeken op artikel, SKU, EAN, OEM, omschrijving...",
    "finalized.products": "Producten",
    "finalized.topBrands": "Top Merken",
    "finalized.productDetails": "Productdetails",
    "finalized.articleNo": "Artikelnr.",
    "finalized.brand": "Merk",
    "finalized.description": "Omschrijving",
    "finalized.stock": "Voorraad",
    "finalized.icCode": "IC Code",
    "finalized.supplier": "Leverancier",
    "finalized.sku": "SKU",
    "finalized.ean": "EAN",
    "finalized.tecdocId": "TecDoc ID",
    "finalized.category": "Categorie",
    "finalized.genericArticle": "Generiek artikel",
    "finalized.status": "Status",
    "finalized.updated": "Bijgewerkt",
    "finalized.created": "Aangemaakt",
    "finalized.weight": "Gewicht",
    "finalized.oemNumbers": "OEM Nummers",
    "finalized.images": "Afbeeldingen",
    "finalized.icMapping": "InterCars Koppeling",
    "finalized.towCode": "TOW Code",
    "finalized.icIndex": "IC Index",
    "finalized.manufacturer": "Fabrikant",
    "finalized.notSet": "Niet ingesteld",

    // Dashboard home
    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Multi-leverancier automotive onderdelen beheer",
    "dashboard.totalProducts": "Totaal Producten",
    "dashboard.activeSuppliers": "Actieve Leveranciers",
    "dashboard.matchRate": "Koppelingsgraad",
    "dashboard.recentActivity": "Recente Activiteit",

    // Products
    "products.title": "Producten",
    "products.subtitle": "Beheer productcatalogus van alle leveranciers",

    // Brands
    "brands.title": "Merken",
    "brands.subtitle": "Beheer fabrikanten van auto-onderdelen",

    // Categories
    "categories.title": "Categorieën",
    "categories.subtitle": "Productcategorieën van TecDoc",

    // Suppliers
    "suppliers.title": "Leveranciers",
    "suppliers.subtitle": "Beheer verbonden leveranciers",

    // Health
    "health.title": "Systeemstatus",
    "health.subtitle": "Monitor systeemstatus en servicegezondheid",
  },
};

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "nl",
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("locale") as Locale) || "nl";
    }
    return "nl";
  });

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      localStorage.setItem("locale", newLocale);
    }
  }, []);

  const t = useCallback(
    (key: string): string => {
      return translations[locale]?.[key] ?? translations.en[key] ?? key;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
