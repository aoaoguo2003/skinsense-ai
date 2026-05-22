export interface Questionnaire {
  skin_type: string;
  skin_concerns: string[];
  skin_sensitivity: string;
  age_range: string;
  gender: string;
  budget: string;
  preferred_texture: string;
  avoid_ingredients: string;
  fragrance_preference: string;
  environment: string;
}

export interface WeatherData {
  city: string;
  country: string;
  temp_c: number;
  humidity: number;
  description: string;
  uv_index: number | null;
}

export interface Ingredient {
  name: string;
  benefit: string;
  concentration_note: string;
}

export interface ProductRecommendation {
  category: string;
  product_name: string;
  brand: string;
  price_range: string;
  why_recommended: string;
  key_ingredients: Ingredient[];
  usage: string;
  purchase_tip: string;
}

export interface IngredientConflict {
  products_involved: string[];
  conflicting_ingredients: string[];
  issue: string;
  severity: "mild" | "moderate" | "severe";
  recommendation: string;
}

export interface IngredientSynergy {
  ingredients: string[];
  synergy: string;
}

export interface ConcernSolution {
  concern: string;
  analysis: string;
  targeted_solution: string;
  key_ingredients: string[];
  weather_impact: string;
}

export interface AnalysisResult {
  skin_analysis: {
    skin_type: string;
    skin_tone: string;
    main_concerns: string[];
    condition_score: number;
    summary: string;
  };
  weather_adjustment: {
    recommendation: string;
    key_considerations: string[];
  };
  concern_solutions?: ConcernSolution[];
  product_recommendations: ProductRecommendation[];
  ingredient_conflicts: {
    current_product_issues: IngredientConflict[];
    recommended_synergies: IngredientSynergy[];
    timing_guide: {
      morning_routine: string[];
      evening_routine: string[];
    };
  };
  lifestyle_tips: string[];
}

export interface AnalyzeResponse {
  status: string;
  weather: WeatherData | null;
  analysis: AnalysisResult;
}
