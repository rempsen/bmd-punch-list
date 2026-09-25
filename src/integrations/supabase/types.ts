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
      companycam_inbox: {
        Row: {
          cc_photo_id: string
          cc_project_id: string | null
          created_at: string
          creator_name: string | null
          deficiency_id: string | null
          description: string | null
          id: string
          photo_url: string | null
          project_id: string
          status: string
          tags: string[]
          taken_at: string | null
          thumb_url: string | null
          web_url: string | null
        }
        Insert: {
          cc_photo_id: string
          cc_project_id?: string | null
          created_at?: string
          creator_name?: string | null
          deficiency_id?: string | null
          description?: string | null
          id?: string
          photo_url?: string | null
          project_id: string
          status?: string
          tags?: string[]
          taken_at?: string | null
          thumb_url?: string | null
          web_url?: string | null
        }
        Update: {
          cc_photo_id?: string
          cc_project_id?: string | null
          created_at?: string
          creator_name?: string | null
          deficiency_id?: string | null
          description?: string | null
          id?: string
          photo_url?: string | null
          project_id?: string
          status?: string
          tags?: string[]
          taken_at?: string | null
          thumb_url?: string | null
          web_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companycam_inbox_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "deficiencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companycam_inbox_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companycam_suggestions: {
        Row: {
          address: string | null
          cc_project_id: string
          created_at: string
          id: string
          kind: string
          name: string | null
          payload: Json | null
          project_id: string | null
          status: string
        }
        Insert: {
          address?: string | null
          cc_project_id: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          payload?: Json | null
          project_id?: string | null
          status?: string
        }
        Update: {
          address?: string | null
          cc_project_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string | null
          payload?: Json | null
          project_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "companycam_suggestions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companycam_sync_log: {
        Row: {
          created_at: string
          direction: string
          entity: string
          error: string | null
          id: string
          local_id: string | null
          payload: Json | null
          project_id: string | null
          remote_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          direction: string
          entity: string
          error?: string | null
          id?: string
          local_id?: string | null
          payload?: Json | null
          project_id?: string | null
          remote_id?: string | null
          status: string
        }
        Update: {
          created_at?: string
          direction?: string
          entity?: string
          error?: string | null
          id?: string
          local_id?: string | null
          payload?: Json | null
          project_id?: string | null
          remote_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "companycam_sync_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companycam_webhook: {
        Row: {
          created_at: string
          id: number
          secret: string | null
          url: string | null
          webhook_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          secret?: string | null
          url?: string | null
          webhook_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          secret?: string | null
          url?: string | null
          webhook_id?: string | null
        }
        Relationships: []
      }
      deficiencies: {
        Row: {
          area: string
          assessment: Database["public"]["Enums"]["assessment_level"]
          assigned_at: string | null
          assigned_to: string | null
          assigned_trade: string | null
          client_decision_note: string | null
          closed_at: string | null
          companycam_task_id: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_outcome:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_reason: string | null
          decision_recommendation:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_requested_at: string | null
          decision_requested_by: string | null
          description: string | null
          due_date: string | null
          email_pending: boolean
          id: string
          is_sample: boolean
          issue_type: string
          item_number: number
          location_id: string
          material: string
          needs_review: boolean
          project_id: string
          responsible_party: Database["public"]["Enums"]["responsible_party"]
          source: string | null
          status: Database["public"]["Enums"]["deficiency_status"]
          updated_at: string
        }
        Insert: {
          area: string
          assessment?: Database["public"]["Enums"]["assessment_level"]
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_trade?: string | null
          client_decision_note?: string | null
          closed_at?: string | null
          companycam_task_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_reason?: string | null
          decision_recommendation?:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_requested_at?: string | null
          decision_requested_by?: string | null
          description?: string | null
          due_date?: string | null
          email_pending?: boolean
          id?: string
          is_sample?: boolean
          issue_type: string
          item_number?: number
          location_id: string
          material: string
          needs_review?: boolean
          project_id: string
          responsible_party?: Database["public"]["Enums"]["responsible_party"]
          source?: string | null
          status?: Database["public"]["Enums"]["deficiency_status"]
          updated_at?: string
        }
        Update: {
          area?: string
          assessment?: Database["public"]["Enums"]["assessment_level"]
          assigned_at?: string | null
          assigned_to?: string | null
          assigned_trade?: string | null
          client_decision_note?: string | null
          closed_at?: string | null
          companycam_task_id?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_outcome?:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_reason?: string | null
          decision_recommendation?:
            | Database["public"]["Enums"]["deficiency_status"]
            | null
          decision_requested_at?: string | null
          decision_requested_by?: string | null
          description?: string | null
          due_date?: string | null
          email_pending?: boolean
          id?: string
          is_sample?: boolean
          issue_type?: string
          item_number?: number
          location_id?: string
          material?: string
          needs_review?: boolean
          project_id?: string
          responsible_party?: Database["public"]["Enums"]["responsible_party"]
          source?: string | null
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
          companycam_photo_id: string | null
          deficiency_id: string
          id: string
          kind: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
          taken_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          companycam_photo_id?: string | null
          deficiency_id: string
          id?: string
          kind?: Database["public"]["Enums"]["photo_kind"]
          storage_path: string
          taken_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          companycam_photo_id?: string | null
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
      email_intake: {
        Row: {
          ai_json: Json | null
          body_text: string | null
          confidence: Json | null
          created_at: string
          deficiency_id: string | null
          error: string | null
          from_email: string | null
          from_name: string | null
          id: string
          message_id: string
          project_id: string | null
          received_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          ai_json?: Json | null
          body_text?: string | null
          confidence?: Json | null
          created_at?: string
          deficiency_id?: string | null
          error?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          message_id: string
          project_id?: string | null
          received_at?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          ai_json?: Json | null
          body_text?: string | null
          confidence?: Json | null
          created_at?: string
          deficiency_id?: string | null
          error?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          message_id?: string
          project_id?: string | null
          received_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_intake_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "deficiencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_intake_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      intake_cron: {
        Row: {
          id: number
          token: string
        }
        Insert: {
          id?: number
          token: string
        }
        Update: {
          id?: number
          token?: string
        }
        Relationships: []
      }
      intake_examples: {
        Row: {
          active: boolean
          corrected: Json
          created_at: string
          created_by: string | null
          email_intake_id: string | null
          email_text: string
          id: string
        }
        Insert: {
          active?: boolean
          corrected: Json
          created_at?: string
          created_by?: string | null
          email_intake_id?: string | null
          email_text: string
          id?: string
        }
        Update: {
          active?: boolean
          corrected?: Json
          created_at?: string
          created_by?: string | null
          email_intake_id?: string | null
          email_text?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_examples_email_intake_id_fkey"
            columns: ["email_intake_id"]
            isOneToOne: false
            referencedRelation: "email_intake"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_settings: {
        Row: {
          created_by_user: string | null
          cursor_at: string | null
          default_project_id: string | null
          id: number
          rules: string
          updated_at: string
        }
        Insert: {
          created_by_user?: string | null
          cursor_at?: string | null
          default_project_id?: string | null
          id?: number
          rules?: string
          updated_at?: string
        }
        Update: {
          created_by_user?: string | null
          cursor_at?: string | null
          default_project_id?: string | null
          id?: number
          rules?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_settings_default_project_id_fkey"
            columns: ["default_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      job_drafts: {
        Row: {
          data: Json
          id: string
          name: string | null
          step: number
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          id?: string
          name?: string | null
          step?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          data?: Json
          id?: string
          name?: string | null
          step?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          project_id: string | null
          sort_order: number
          value: string
        }
        Insert: {
          active?: boolean
          id?: string
          kind: Database["public"]["Enums"]["pick_kind"]
          project_id?: string | null
          sort_order?: number
          value: string
        }
        Update: {
          active?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["pick_kind"]
          project_id?: string | null
          sort_order?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_lists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          companycam_user_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          company?: string | null
          companycam_user_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          company?: string | null
          companycam_user_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      project_contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          kind: string
          name: string | null
          phone_mobile: string | null
          phone_office: string | null
          project_id: string
          sort_order: number
          title: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          name?: string | null
          phone_mobile?: string | null
          phone_office?: string | null
          project_id: string
          sort_order?: number
          title?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          kind?: string
          name?: string | null
          phone_mobile?: string | null
          phone_office?: string | null
          project_id?: string
          sort_order?: number
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_contacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scopes: {
        Row: {
          created_at: string
          id: string
          other_text: string | null
          project_id: string
          scope: string
        }
        Insert: {
          created_at?: string
          id?: string
          other_text?: string | null
          project_id: string
          scope: string
        }
        Update: {
          created_at?: string
          id?: string
          other_text?: string | null
          project_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scopes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          archived_at: string | null
          building_type: string | null
          city: string | null
          client_name: string | null
          companycam_last_sync_at: string | null
          companycam_options: Json
          companycam_project_id: string | null
          companycam_project_url: string | null
          companycam_sync_enabled: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          po_number: string | null
          postal_code: string | null
          province: string | null
          start_date: string | null
          street: string | null
          target_date: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          building_type?: string | null
          city?: string | null
          client_name?: string | null
          companycam_last_sync_at?: string | null
          companycam_options?: Json
          companycam_project_id?: string | null
          companycam_project_url?: string | null
          companycam_sync_enabled?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          po_number?: string | null
          postal_code?: string | null
          province?: string | null
          start_date?: string | null
          street?: string | null
          target_date?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          building_type?: string | null
          city?: string | null
          client_name?: string | null
          companycam_last_sync_at?: string | null
          companycam_options?: Json
          companycam_project_id?: string | null
          companycam_project_url?: string | null
          companycam_sync_enabled?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          po_number?: string | null
          postal_code?: string | null
          province?: string | null
          start_date?: string | null
          street?: string | null
          target_date?: string | null
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
          expires_at: string
          full_name: string | null
          id: string
          invite_token: string
          invited_by: string | null
          last_error: string | null
          project_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          sent_at: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          company?: string | null
          created_at?: string
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          last_error?: string | null
          project_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          sent_at?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          company?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          last_error?: string | null
          project_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      add_member_by_email: {
        Args: {
          _email: string
          _project: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      create_job: { Args: { _job: Json }; Returns: string }
      create_project: {
        Args: { _address: string; _client: string; _name: string }
        Returns: string
      }
      decision_note: {
        Args: { d: Database["public"]["Tables"]["deficiencies"]["Row"] }
        Returns: string
      }
      decision_notes: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          note: string
        }[]
      }
      deficiency_project: { Args: { _def: string }; Returns: string }
      expire_old_invites: { Args: never; Returns: undefined }
      floor_project: { Args: { _floor: string }; Returns: string }
      has_capability:
        | { Args: { _capability: string }; Returns: boolean }
        | { Args: { _capability: string; _project: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_my_assignment: {
        Args: { _assigned_to: string; _trade: string }
        Returns: boolean
      }
      is_project_member: { Args: { _project: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      list_users: {
        Args: { _project: string }
        Returns: {
          company: string
          email: string
          full_name: string
          id: string
          is_super: boolean
          last_sign_in_at: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      location_project: { Args: { _loc: string }; Returns: string }
      move_deficiency: {
        Args: { _id: string; _location: string }
        Returns: number
      }
      my_projects: {
        Args: never
        Returns: {
          address: string
          archived_at: string
          client_name: string
          id: string
          name: string
          open_count: number
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      photo_path_project: { Args: { _name: string }; Returns: string }
      project_directory: {
        Args: { _project: string }
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      project_people: {
        Args: { _project: string }
        Returns: {
          company: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      remove_member: {
        Args: { _project: string; _user_id: string }
        Returns: undefined
      }
      reset_role_permissions: { Args: never; Returns: undefined }
      set_member_role: {
        Args: {
          _company?: string
          _project: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
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
      responsible_party: "bmd" | "trade" | "client" | "unassigned"
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
      responsible_party: ["bmd", "trade", "client", "unassigned"],
    },
  },
} as const
