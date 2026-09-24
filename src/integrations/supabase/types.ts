export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      deficiencies: {
        Row: {
          area: string
          assessment: Database["public"]["Enums"]["assessment_level"]
          assigned_to: string | null
          client_decision_note: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          is_sample: boolean
          issue_type: string
          item_number: number
          location_id: string
          material: string
          project_id: string
          status: Database["public"]["Enums"]["deficiency_status"]
          updated_at: string
        }
        Insert: {
          area: string
          assessment?: Database["public"]["Enums"]["assessment_level"]
          assigned_to?: string | null
          client_decision_note?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_sample?: boolean
          issue_type: string
          item_number?: number
          location_id: string
          material: string
          project_id: string
          status?: Database["public"]["Enums"]["deficiency_status"]
          updated_at?: string
        }
        Update: {
          area?: string
          assessment?: Database["public"]["Enums"]["assessment_level"]
          assigned_to?: string | null
          client_decision_note?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          is_sample?: boolean
          issue_type?: string
          item_number?: number
          location_id?: string
          material?: string
          project_id?: string
          status?: Database["public"]["Enums"]["deficiency_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deficiencies_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deficiencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deficiency_events: {
        Row: {
          created_at: string
          deficiency_id: string
          event_type: string
          from_value: string | null
          id: string
          note: string | null
          to_value: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deficiency_id: string
          event_type: string
          from_value?: string | null
          id?: string
          note?: string | null
          to_value?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deficiency_id?: string
          event_type?: string
          from_value?: string | null
          id?: string
          note?: string | null
          to_value?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deficiency_events_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "deficiencies"
            referencedColumns: ["id"]
          },
        ]
      }
      deficiency_photos: {
        Row: {
          caption: string | null
          deficiency_id: string
          id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
          taken_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          deficiency_id: string
          id?: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
          taken_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          deficiency_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          storage_path?: string
          taken_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deficiency_photos_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "deficiencies"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          id: string
          label: string
          number: number
          project_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          label: string
          number: number
          project_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          label?: string
          number?: number
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "floors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          floor_id: string
          id: string
          name: string
          room_type: string | null
          sort_order: number
          type: Database["public"]["Enums"]["location_type"]
        }
        Insert: {
          created_at?: string
          floor_id: string
          id?: string
          name: string
          room_type?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["location_type"]
        }
        Update: {
          created_at?: string
          floor_id?: string
          id?: string
          name?: string
          room_type?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["location_type"]
        }
        Relationships: [
          {
            foreignKeyName: "locations_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_lists: {
        Row: {
          active: boolean
          id: string
          kind: Database["public"]["Enums"]["pick_kind"]
          sort_order: number
          value: string
        }
        Insert: {
          active?: boolean
          id?: string
          kind: Database["public"]["Enums"]["pick_kind"]
          sort_order?: number
          value: string
        }
        Update: {
          active?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["pick_kind"]
          sort_order?: number
          value?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          address: string | null
          client_name: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          address?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          address?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          capability: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          capability?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          accepted_at: string | null
          company: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          accepted_at?: string | null
          company?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          accepted_at?: string | null
          company?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decision_note: {
        Args: { d: Database["public"]["Tables"]["deficiencies"]["Row"] }
        Returns: string
      }
      has_capability: { Args: { _capability: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_users: {
        Args: never
        Returns: {
          company: string
          email: string
          full_name: string
          id: string
          last_sign_in_at: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      reset_role_permissions: { Args: never; Returns: undefined }
      set_user_role: {
        Args: {
          _company?: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "bmd_admin"
        | "bmd_field"
        | "client"
        | "super_admin"
        | "bmd_manager"
        | "trade"
        | "viewer"
      assessment_level: "acceptable" | "client_review" | "must_fix"
      deficiency_status:
        | "open"
        | "awaiting_client"
        | "accepted_as_is"
        | "fix_required"
        | "in_progress"
        | "fixed"
        | "verified"
      location_type: "room" | "common_area"
      photo_kind: "before" | "after"
      pick_kind: "area" | "material" | "issue_type"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "bmd_admin",
        "bmd_field",
        "client",
        "super_admin",
        "bmd_manager",
        "trade",
        "viewer",
      ],
      assessment_level: ["acceptable", "client_review", "must_fix"],
      deficiency_status: [
        "open",
        "awaiting_client",
        "accepted_as_is",
        "fix_required",
        "in_progress",
        "fixed",
        "verified",
      ],
      location_type: ["room", "common_area"],
      photo_kind: ["before", "after"],
      pick_kind: ["area", "material", "issue_type"],
    },
  },
} as const
