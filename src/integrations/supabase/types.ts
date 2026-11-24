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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      ai_proposals: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          payload: Json
          project_id: string
          source_note: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          payload: Json
          project_id: string
          source_note?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          payload?: Json
          project_id?: string
          source_note?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      arriveping_link: {
        Row: {
          connected_at: string | null
          connected_by: string | null
          events: string | null
          id: number
          last_check_at: string | null
          last_check_error: string | null
          secret_enc: string | null
          subscription_id: string | null
          webhook_url: string | null
        }
        Insert: {
          connected_at?: string | null
          connected_by?: string | null
          events?: string | null
          id?: number
          last_check_at?: string | null
          last_check_error?: string | null
          secret_enc?: string | null
          subscription_id?: string | null
          webhook_url?: string | null
        }
        Update: {
          connected_at?: string | null
          connected_by?: string | null
          events?: string | null
          id?: number
          last_check_at?: string | null
          last_check_error?: string | null
          secret_enc?: string | null
          subscription_id?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      assembly_template_components: {
        Row: {
          catalogue_material_id: string | null
          cost_uom: string | null
          id: string
          kind: string
          label: string
          labour_rate_id: string | null
          on_gross: boolean
          pst_applies: boolean
          qty_per_driver: number
          round_up: boolean
          sort_order: number
          source: string
          template_id: string
          unit_cost_cents: number | null
          waste_pct: number | null
        }
        Insert: {
          catalogue_material_id?: string | null
          cost_uom?: string | null
          id?: string
          kind: string
          label: string
          labour_rate_id?: string | null
          on_gross?: boolean
          pst_applies?: boolean
          qty_per_driver?: number
          round_up?: boolean
          sort_order?: number
          source: string
          template_id: string
          unit_cost_cents?: number | null
          waste_pct?: number | null
        }
        Update: {
          catalogue_material_id?: string | null
          cost_uom?: string | null
          id?: string
          kind?: string
          label?: string
          labour_rate_id?: string | null
          on_gross?: boolean
          pst_applies?: boolean
          qty_per_driver?: number
          round_up?: boolean
          sort_order?: number
          source?: string
          template_id?: string
          unit_cost_cents?: number | null
          waste_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assembly_template_components_catalogue_material_id_fkey"
            columns: ["catalogue_material_id"]
            isOneToOne: false
            referencedRelation: "catalogue_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_template_components_labour_rate_id_fkey"
            columns: ["labour_rate_id"]
            isOneToOne: false
            referencedRelation: "labour_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_template_components_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "assembly_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_templates: {
        Row: {
          active: boolean
          category: string
          cost_code: string | null
          created_at: string
          default_waste_pct: number
          driver_uom: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          category?: string
          cost_code?: string | null
          created_at?: string
          default_waste_pct?: number
          driver_uom?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          category?: string
          cost_code?: string | null
          created_at?: string
          default_waste_pct?: number
          driver_uom?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "assembly_templates_cost_code_fkey"
            columns: ["cost_code"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      catalogue_materials: {
        Row: {
          active: boolean
          category: string
          colour: string | null
          cost_code: string | null
          cost_uom: string
          coverage_per_purchase_unit: number | null
          coverage_uom: string | null
          created_at: string
          default_waste_pct: number
          id: string
          manufacturer: string | null
          name: string
          notes: string | null
          price_date: string | null
          price_source: string | null
          product_line: string | null
          pst_applies: boolean
          purchase_uom: string
          sku: string | null
          supplier_id: string | null
          unit_cost_cents: number | null
          uom_confirmed: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          colour?: string | null
          cost_code?: string | null
          cost_uom?: string
          coverage_per_purchase_unit?: number | null
          coverage_uom?: string | null
          created_at?: string
          default_waste_pct?: number
          id?: string
          manufacturer?: string | null
          name: string
          notes?: string | null
          price_date?: string | null
          price_source?: string | null
          product_line?: string | null
          pst_applies?: boolean
          purchase_uom?: string
          sku?: string | null
          supplier_id?: string | null
          unit_cost_cents?: number | null
          uom_confirmed?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          colour?: string | null
          cost_code?: string | null
          cost_uom?: string
          coverage_per_purchase_unit?: number | null
          coverage_uom?: string | null
          created_at?: string
          default_waste_pct?: number
          id?: string
          manufacturer?: string | null
          name?: string
          notes?: string | null
          price_date?: string | null
          price_source?: string | null
          product_line?: string | null
          pst_applies?: boolean
          purchase_uom?: string
          sku?: string | null
          supplier_id?: string | null
          unit_cost_cents?: number | null
          uom_confirmed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_materials_cost_code_fkey"
            columns: ["cost_code"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "catalogue_materials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string | null
          phone_mobile: string | null
          phone_office: string | null
          title: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string | null
          phone_mobile?: string | null
          phone_office?: string | null
          title?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string | null
          phone_mobile?: string | null
          phone_office?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          billing_address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          onedrive_folder_id: string | null
          phone: string | null
          qbo_customer_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          onedrive_folder_id?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          onedrive_folder_id?: string | null
          phone?: string | null
          qbo_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
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
      cost_codes: {
        Row: {
          code: string
          name: string
          qbo_item_id: string | null
          sort_order: number
        }
        Insert: {
          code: string
          name: string
          qbo_item_id?: string | null
          sort_order?: number
        }
        Update: {
          code?: string
          name?: string
          qbo_item_id?: string | null
          sort_order?: number
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
      estimate_import_rows: {
        Row: {
          decision: string
          id: string
          import_id: string
          issue: string | null
          proposed: Json | null
          raw: Json
          source_ref: string
        }
        Insert: {
          decision: string
          id?: string
          import_id: string
          issue?: string | null
          proposed?: Json | null
          raw: Json
          source_ref: string
        }
        Update: {
          decision?: string
          id?: string
          import_id?: string
          issue?: string | null
          proposed?: Json | null
          raw?: Json
          source_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "estimate_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_imports: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string | null
          file_name: string
          id: string
          kind: string
          project_id: string
          reconciliation: Json
          source_totals: Json
          status: string
          version_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          file_name: string
          id?: string
          kind: string
          project_id: string
          reconciliation?: Json
          source_totals?: Json
          status?: string
          version_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          file_name?: string
          id?: string
          kind?: string
          project_id?: string
          reconciliation?: Json
          source_totals?: Json
          status?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_imports_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_imports_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_line_components: {
        Row: {
          catalogue_material_id: string | null
          cost_overridden: boolean
          cost_uom: string
          coverage_per_purchase_unit: number | null
          id: string
          kind: string
          label: string
          labour_rate_id: string | null
          line_id: string
          not_applicable: boolean
          on_gross: boolean
          pst_applies: boolean
          purchase_uom: string
          qty_per_driver: number
          round_up: boolean
          sort_order: number
          source: string
          unit_cost_cents: number | null
          waste_pct: number
        }
        Insert: {
          catalogue_material_id?: string | null
          cost_overridden?: boolean
          cost_uom: string
          coverage_per_purchase_unit?: number | null
          id?: string
          kind: string
          label: string
          labour_rate_id?: string | null
          line_id: string
          not_applicable?: boolean
          on_gross?: boolean
          pst_applies?: boolean
          purchase_uom: string
          qty_per_driver?: number
          round_up?: boolean
          sort_order?: number
          source: string
          unit_cost_cents?: number | null
          waste_pct?: number
        }
        Update: {
          catalogue_material_id?: string | null
          cost_overridden?: boolean
          cost_uom?: string
          coverage_per_purchase_unit?: number | null
          id?: string
          kind?: string
          label?: string
          labour_rate_id?: string | null
          line_id?: string
          not_applicable?: boolean
          on_gross?: boolean
          pst_applies?: boolean
          purchase_uom?: string
          qty_per_driver?: number
          round_up?: boolean
          sort_order?: number
          source?: string
          unit_cost_cents?: number | null
          waste_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_components_catalogue_material_id_fkey"
            columns: ["catalogue_material_id"]
            isOneToOne: false
            referencedRelation: "catalogue_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_components_labour_rate_id_fkey"
            columns: ["labour_rate_id"]
            isOneToOne: false
            referencedRelation: "labour_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_components_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "estimate_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_lines: {
        Row: {
          cost_code: string | null
          created_at: string
          description: string
          detached: boolean
          driver_qty: number
          driver_uom: string
          finish_id: string | null
          fixed_sell_cents: number | null
          id: string
          is_allowance: boolean
          kind: string
          margin_pct: number | null
          markup_pct: number
          notes: string | null
          price_basis: string
          row_version: number
          section: string
          selection: string
          selection_group: string | null
          sort_order: number
          source: string
          subject_to_measure: boolean
          takeoff_condition_id: string | null
          tax_code: string
          updated_at: string
          version_id: string
          waste_pct: number
        }
        Insert: {
          cost_code?: string | null
          created_at?: string
          description?: string
          detached?: boolean
          driver_qty?: number
          driver_uom?: string
          finish_id?: string | null
          fixed_sell_cents?: number | null
          id?: string
          is_allowance?: boolean
          kind?: string
          margin_pct?: number | null
          markup_pct?: number
          notes?: string | null
          price_basis?: string
          row_version?: number
          section?: string
          selection?: string
          selection_group?: string | null
          sort_order?: number
          source?: string
          subject_to_measure?: boolean
          takeoff_condition_id?: string | null
          tax_code?: string
          updated_at?: string
          version_id: string
          waste_pct?: number
        }
        Update: {
          cost_code?: string | null
          created_at?: string
          description?: string
          detached?: boolean
          driver_qty?: number
          driver_uom?: string
          finish_id?: string | null
          fixed_sell_cents?: number | null
          id?: string
          is_allowance?: boolean
          kind?: string
          margin_pct?: number | null
          markup_pct?: number
          notes?: string | null
          price_basis?: string
          row_version?: number
          section?: string
          selection?: string
          selection_group?: string | null
          sort_order?: number
          source?: string
          subject_to_measure?: boolean
          takeoff_condition_id?: string | null
          tax_code?: string
          updated_at?: string
          version_id?: string
          waste_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_lines_cost_code_fkey"
            columns: ["cost_code"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "estimate_lines_finish_id_fkey"
            columns: ["finish_id"]
            isOneToOne: false
            referencedRelation: "project_finishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_lines_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "estimate_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_versions: {
        Row: {
          co_number: number | null
          created_at: string
          created_by: string | null
          default_markup_pct: number
          description: string | null
          id: string
          is_base: boolean
          kind: string
          locked: boolean
          name: string
          project_id: string
          sort_order: number
          status: string
        }
        Insert: {
          co_number?: number | null
          created_at?: string
          created_by?: string | null
          default_markup_pct?: number
          description?: string | null
          id?: string
          is_base?: boolean
          kind?: string
          locked?: boolean
          name: string
          project_id: string
          sort_order?: number
          status?: string
        }
        Update: {
          co_number?: number | null
          created_at?: string
          created_by?: string | null
          default_markup_pct?: number
          description?: string | null
          id?: string
          is_base?: boolean
          kind?: string
          locked?: boolean
          name?: string
          project_id?: string
          sort_order?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_versions_project_id_fkey"
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
      install_visit_events: {
        Row: {
          at: string
          id: string
          note: string
          project_id: string
          source: string
          status: string
          visit_id: string
        }
        Insert: {
          at?: string
          id?: string
          note: string
          project_id: string
          source?: string
          status: string
          visit_id: string
        }
        Update: {
          at?: string
          id?: string
          note?: string
          project_id?: string
          source?: string
          status?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "install_visit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_visit_events_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "install_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      install_visits: {
        Row: {
          areas: Json
          arriveping_assigned_to: string | null
          arriveping_job_id: string | null
          arriveping_last_event_at: string | null
          arriveping_status: string | null
          assigned_name: string | null
          assigned_user_id: string | null
          created_at: string
          created_by: string | null
          crew: string | null
          ends_at: string | null
          id: string
          notes: string | null
          project_id: string
          scope: string | null
          site_contact: string | null
          starts_at: string
          status: string
        }
        Insert: {
          areas?: Json
          arriveping_assigned_to?: string | null
          arriveping_job_id?: string | null
          arriveping_last_event_at?: string | null
          arriveping_status?: string | null
          assigned_name?: string | null
          assigned_user_id?: string | null
          created_at?: string
          created_by?: string | null
          crew?: string | null
          ends_at?: string | null
          id?: string
          notes?: string | null
          project_id: string
          scope?: string | null
          site_contact?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          areas?: Json
          arriveping_assigned_to?: string | null
          arriveping_job_id?: string | null
          arriveping_last_event_at?: string | null
          arriveping_status?: string | null
          assigned_name?: string | null
          assigned_user_id?: string | null
          created_at?: string
          created_by?: string | null
          crew?: string | null
          ends_at?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          scope?: string | null
          site_contact?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "install_visits_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "install_visits_project_id_fkey"
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
      labour_rates: {
        Row: {
          active: boolean
          cost_code: string | null
          created_at: string
          id: string
          name: string
          unit_cost_cents: number | null
          uom: string
          uom_confirmed: boolean
        }
        Insert: {
          active?: boolean
          cost_code?: string | null
          created_at?: string
          id?: string
          name: string
          unit_cost_cents?: number | null
          uom?: string
          uom_confirmed?: boolean
        }
        Update: {
          active?: boolean
          cost_code?: string | null
          created_at?: string
          id?: string
          name?: string
          unit_cost_cents?: number | null
          uom?: string
          uom_confirmed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "labour_rates_cost_code_fkey"
            columns: ["cost_code"]
            isOneToOne: false
            referencedRelation: "cost_codes"
            referencedColumns: ["code"]
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
      material_orders: {
        Row: {
          catalogue_item_id: string | null
          created_at: string
          description: string
          estimate_line_id: string | null
          id: string
          notes: string | null
          on_site_at: string | null
          on_site_by: string | null
          ordered_at: string
          po_number: string | null
          project_id: string
          qbo_po_id: string | null
          qbo_po_sent_at: string | null
          quantity: number
          received_at: string | null
          received_by: string | null
          received_note: string | null
          received_qty: number | null
          status: string
          supplier_id: string | null
          unit: string
          unit_cost_cents: number | null
          updated_at: string
        }
        Insert: {
          catalogue_item_id?: string | null
          created_at?: string
          description?: string
          estimate_line_id?: string | null
          id?: string
          notes?: string | null
          on_site_at?: string | null
          on_site_by?: string | null
          ordered_at?: string
          po_number?: string | null
          project_id: string
          qbo_po_id?: string | null
          qbo_po_sent_at?: string | null
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          received_note?: string | null
          received_qty?: number | null
          status?: string
          supplier_id?: string | null
          unit?: string
          unit_cost_cents?: number | null
          updated_at?: string
        }
        Update: {
          catalogue_item_id?: string | null
          created_at?: string
          description?: string
          estimate_line_id?: string | null
          id?: string
          notes?: string | null
          on_site_at?: string | null
          on_site_by?: string | null
          ordered_at?: string
          po_number?: string | null
          project_id?: string
          qbo_po_id?: string | null
          qbo_po_sent_at?: string | null
          quantity?: number
          received_at?: string | null
          received_by?: string | null
          received_note?: string | null
          received_qty?: number | null
          status?: string
          supplier_id?: string | null
          unit?: string
          unit_cost_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_orders_catalogue_item_id_fkey"
            columns: ["catalogue_item_id"]
            isOneToOne: false
            referencedRelation: "catalogue_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_orders_estimate_line_id_fkey"
            columns: ["estimate_line_id"]
            isOneToOne: false
            referencedRelation: "estimate_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_orders_on_site_by_fkey"
            columns: ["on_site_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_orders_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ms_connections: {
        Row: {
          account_email: string
          connected_at: string
          is_library_connection: boolean
          last_error: string | null
          onedrive_root_item_id: string | null
          onedrive_root_path: string | null
          refresh_token_enc: string
          scopes: string | null
          user_id: string
        }
        Insert: {
          account_email: string
          connected_at?: string
          is_library_connection?: boolean
          last_error?: string | null
          onedrive_root_item_id?: string | null
          onedrive_root_path?: string | null
          refresh_token_enc: string
          scopes?: string | null
          user_id: string
        }
        Update: {
          account_email?: string
          connected_at?: string
          is_library_connection?: boolean
          last_error?: string | null
          onedrive_root_item_id?: string | null
          onedrive_root_path?: string | null
          refresh_token_enc?: string
          scopes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      onedrive_mirror_queue: {
        Row: {
          action: string
          attempts: number
          created_at: string
          document_id: string | null
          id: string
          last_error: string | null
          next_attempt_at: string
          next_offset: number
          project_id: string
          status: string
          upload_url: string | null
        }
        Insert: {
          action: string
          attempts?: number
          created_at?: string
          document_id?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          next_offset?: number
          project_id: string
          status?: string
          upload_url?: string | null
        }
        Update: {
          action?: string
          attempts?: number
          created_at?: string
          document_id?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          next_offset?: number
          project_id?: string
          status?: string
          upload_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onedrive_mirror_queue_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onedrive_mirror_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      plan_sheets: {
        Row: {
          created_at: string
          discipline: string | null
          document_id: string
          floor_label: string | null
          height_pt: number | null
          id: string
          page_number: number
          project_id: string
          rotation: number
          sheet_number: string | null
          title: string | null
          width_pt: number | null
        }
        Insert: {
          created_at?: string
          discipline?: string | null
          document_id: string
          floor_label?: string | null
          height_pt?: number | null
          id?: string
          page_number: number
          project_id: string
          rotation?: number
          sheet_number?: string | null
          title?: string | null
          width_pt?: number | null
        }
        Update: {
          created_at?: string
          discipline?: string | null
          document_id?: string
          floor_label?: string | null
          height_pt?: number | null
          id?: string
          page_number?: number
          project_id?: string
          rotation?: number
          sheet_number?: string | null
          title?: string | null
          width_pt?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_sheets_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sheets_project_id_fkey"
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
      progress_bills: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string | null
          gross_cents: number
          gst_cents: number
          holdback_cents: number
          holdback_pct: number
          id: string
          issued_at: string | null
          kind: string
          lines: Json
          net_cents: number
          number: string
          period_note: string | null
          project_id: string
          qbo_invoice_id: string | null
          seq: number
          status: string
          total_cents: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          gross_cents: number
          gst_cents: number
          holdback_cents: number
          holdback_pct: number
          id?: string
          issued_at?: string | null
          kind: string
          lines?: Json
          net_cents: number
          number: string
          period_note?: string | null
          project_id: string
          qbo_invoice_id?: string | null
          seq: number
          status?: string
          total_cents: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          gross_cents?: number
          gst_cents?: number
          holdback_cents?: number
          holdback_pct?: number
          id?: string
          issued_at?: string | null
          kind?: string
          lines?: Json
          net_cents?: number
          number?: string
          period_note?: string | null
          project_id?: string
          qbo_invoice_id?: string | null
          seq?: number
          status?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "progress_bills_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_bills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_documents: {
        Row: {
          catalogue_material_id: string | null
          created_at: string
          file_name: string
          id: string
          mime: string | null
          mirror_error: string | null
          mirror_status: string
          note: string | null
          onedrive_item_id: string | null
          project_id: string
          section: Database["public"]["Enums"]["document_section"]
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          catalogue_material_id?: string | null
          created_at?: string
          file_name: string
          id?: string
          mime?: string | null
          mirror_error?: string | null
          mirror_status?: string
          note?: string | null
          onedrive_item_id?: string | null
          project_id: string
          section: Database["public"]["Enums"]["document_section"]
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          catalogue_material_id?: string | null
          created_at?: string
          file_name?: string
          id?: string
          mime?: string | null
          mirror_error?: string | null
          mirror_status?: string
          note?: string | null
          onedrive_item_id?: string | null
          project_id?: string
          section?: Database["public"]["Enums"]["document_section"]
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_finishes: {
        Row: {
          assembly_template_id: string | null
          catalogue_material_id: string | null
          created_at: string
          description: string | null
          id: string
          project_id: string
          sort_order: number
          tag: string
        }
        Insert: {
          assembly_template_id?: string | null
          catalogue_material_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          project_id: string
          sort_order?: number
          tag: string
        }
        Update: {
          assembly_template_id?: string | null
          catalogue_material_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          project_id?: string
          sort_order?: number
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_finishes_assembly_template_id_fkey"
            columns: ["assembly_template_id"]
            isOneToOne: false
            referencedRelation: "assembly_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_finishes_catalogue_material_id_fkey"
            columns: ["catalogue_material_id"]
            isOneToOne: false
            referencedRelation: "catalogue_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_finishes_project_id_fkey"
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
          job_roles: Database["public"]["Enums"]["job_role"][]
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          role_source: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          job_roles?: Database["public"]["Enums"]["job_role"][]
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          role_source: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          job_roles?: Database["public"]["Enums"]["job_role"][]
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          role_source?: string
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
      project_number_counters: {
        Row: {
          last_seq: number
          year: number
        }
        Insert: {
          last_seq: number
          year: number
        }
        Update: {
          last_seq?: number
          year?: number
        }
        Relationships: []
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
      project_stage_events: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage: Database["public"]["Enums"]["project_stage"] | null
          id: string
          note: string | null
          project_id: string
          to_stage: Database["public"]["Enums"]["project_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["public"]["Enums"]["project_stage"] | null
          id?: string
          note?: string | null
          project_id: string
          to_stage: Database["public"]["Enums"]["project_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: Database["public"]["Enums"]["project_stage"] | null
          id?: string
          note?: string | null
          project_id?: string
          to_stage?: Database["public"]["Enums"]["project_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "project_stage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_takeoff_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          doc: Json
          id: string
          label: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc: Json
          id?: string
          label?: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc?: Json
          id?: string
          label?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_takeoff_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_takeoffs: {
        Row: {
          doc: Json
          project_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          doc: Json
          project_id: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          doc?: Json
          project_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_takeoffs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          archived_at: string | null
          bid_due_date: string | null
          building_type: string | null
          city: string | null
          client_id: string | null
          client_name: string | null
          companycam_last_sync_at: string | null
          companycam_options: Json
          companycam_project_id: string | null
          companycam_project_url: string | null
          companycam_sync_enabled: boolean
          created_at: string
          estimated_value_cents: number | null
          holdback_pct: number
          id: string
          job_type: string | null
          lost_note: string | null
          lost_reason: string | null
          name: string
          notes: string | null
          onedrive_folder_id: string | null
          onedrive_parent_item_id: string | null
          onedrive_parent_path: string | null
          po_number: string | null
          postal_code: string | null
          project_number: string | null
          province: string | null
          stage: Database["public"]["Enums"]["project_stage"]
          stage_entered_at: string
          start_date: string | null
          street: string | null
          target_date: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          bid_due_date?: string | null
          building_type?: string | null
          city?: string | null
          client_id?: string | null
          client_name?: string | null
          companycam_last_sync_at?: string | null
          companycam_options?: Json
          companycam_project_id?: string | null
          companycam_project_url?: string | null
          companycam_sync_enabled?: boolean
          created_at?: string
          estimated_value_cents?: number | null
          holdback_pct?: number
          id?: string
          job_type?: string | null
          lost_note?: string | null
          lost_reason?: string | null
          name: string
          notes?: string | null
          onedrive_folder_id?: string | null
          onedrive_parent_item_id?: string | null
          onedrive_parent_path?: string | null
          po_number?: string | null
          postal_code?: string | null
          project_number?: string | null
          province?: string | null
          stage?: Database["public"]["Enums"]["project_stage"]
          stage_entered_at?: string
          start_date?: string | null
          street?: string | null
          target_date?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          bid_due_date?: string | null
          building_type?: string | null
          city?: string | null
          client_id?: string | null
          client_name?: string | null
          companycam_last_sync_at?: string | null
          companycam_options?: Json
          companycam_project_id?: string | null
          companycam_project_url?: string | null
          companycam_sync_enabled?: boolean
          created_at?: string
          estimated_value_cents?: number | null
          holdback_pct?: number
          id?: string
          job_type?: string | null
          lost_note?: string | null
          lost_reason?: string | null
          name?: string
          notes?: string | null
          onedrive_folder_id?: string | null
          onedrive_parent_item_id?: string | null
          onedrive_parent_path?: string | null
          po_number?: string | null
          postal_code?: string | null
          project_number?: string | null
          province?: string | null
          stage?: Database["public"]["Enums"]["project_stage"]
          stage_entered_at?: string
          start_date?: string | null
          street?: string | null
          target_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connection: {
        Row: {
          company_name: string | null
          connected_at: string
          connected_by: string | null
          id: number
          last_error: string | null
          last_pull_at: string | null
          realm_id: string
          refresh_token_enc: string
        }
        Insert: {
          company_name?: string | null
          connected_at?: string
          connected_by?: string | null
          id?: number
          last_error?: string | null
          last_pull_at?: string | null
          realm_id: string
          refresh_token_enc: string
        }
        Update: {
          company_name?: string | null
          connected_at?: string
          connected_by?: string | null
          id?: number
          last_error?: string | null
          last_pull_at?: string | null
          realm_id?: string
          refresh_token_enc?: string
        }
        Relationships: []
      }
      quote_acceptances: {
        Row: {
          accepted_at: string
          choices: Json
          email: string
          id: string
          link_id: string | null
          name: string
          quote_id: string
          total_cents: number
          value_cents: number
          version_id: string
        }
        Insert: {
          accepted_at?: string
          choices?: Json
          email: string
          id?: string
          link_id?: string | null
          name: string
          quote_id: string
          total_cents: number
          value_cents: number
          version_id: string
        }
        Update: {
          accepted_at?: string
          choices?: Json
          email?: string
          id?: string
          link_id?: string | null
          name?: string
          quote_id?: string
          total_cents?: number
          value_cents?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_acceptances_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "quote_share_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_acceptances_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_clauses: {
        Row: {
          active: boolean
          body: string
          created_at: string
          id: string
          is_default: boolean
          kind: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          id?: string
          is_default?: boolean
          kind?: string
          sort_order?: number
        }
        Relationships: []
      }
      quote_settings: {
        Row: {
          company_name: string
          default_notes: string
          email: string
          footer_text: string
          gst_number: string
          id: number
          logo_data_url: string | null
          logo_height: number | null
          logo_width: number | null
          mailing_address: string
          office_address: string
          phone: string
          short_terms: string[]
          terms_text: string
          terms_title: string
          updated_at: string
          updated_by: string | null
          website: string
        }
        Insert: {
          company_name?: string
          default_notes?: string
          email?: string
          footer_text?: string
          gst_number?: string
          id?: number
          logo_data_url?: string | null
          logo_height?: number | null
          logo_width?: number | null
          mailing_address?: string
          office_address?: string
          phone?: string
          short_terms?: string[]
          terms_text?: string
          terms_title?: string
          updated_at?: string
          updated_by?: string | null
          website?: string
        }
        Update: {
          company_name?: string
          default_notes?: string
          email?: string
          footer_text?: string
          gst_number?: string
          id?: number
          logo_data_url?: string | null
          logo_height?: number | null
          logo_width?: number | null
          mailing_address?: string
          office_address?: string
          phone?: string
          short_terms?: string[]
          terms_text?: string
          terms_title?: string
          updated_at?: string
          updated_by?: string | null
          website?: string
        }
        Relationships: []
      }
      quote_share_links: {
        Row: {
          choices: Json
          created_at: string
          created_by: string | null
          id: string
          last_viewed_at: string | null
          quote_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          choices?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          last_viewed_at?: string | null
          quote_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          choices?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          last_viewed_at?: string | null
          quote_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_share_links_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          accepted_value_cents: number | null
          accepted_version_id: string | null
          attention: string | null
          clarifications: string[]
          client_notes: string
          co_number: number | null
          created_at: string
          created_by: string | null
          decided_by: string | null
          decision_note: string | null
          deposit: string | null
          display: Json | null
          document_id: string | null
          drawing_sheet_ids: string[]
          drawing_sheets: string[]
          exclusions: string[]
          id: string
          inclusions: string[]
          kind: string
          number: string
          presentation: string
          project_id: string
          qbo_estimate_id: string | null
          recipients: string[]
          revision: number
          rollup: Json | null
          sent_at: string | null
          sent_by: string | null
          snapshot: Json | null
          status: string
          validity_days: number
          value_cents: number | null
          version_ids: string[]
        }
        Insert: {
          accepted_at?: string | null
          accepted_value_cents?: number | null
          accepted_version_id?: string | null
          attention?: string | null
          clarifications?: string[]
          client_notes?: string
          co_number?: number | null
          created_at?: string
          created_by?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deposit?: string | null
          display?: Json | null
          document_id?: string | null
          drawing_sheet_ids?: string[]
          drawing_sheets?: string[]
          exclusions?: string[]
          id?: string
          inclusions?: string[]
          kind: string
          number: string
          presentation?: string
          project_id: string
          qbo_estimate_id?: string | null
          recipients?: string[]
          revision?: number
          rollup?: Json | null
          sent_at?: string | null
          sent_by?: string | null
          snapshot?: Json | null
          status?: string
          validity_days?: number
          value_cents?: number | null
          version_ids: string[]
        }
        Update: {
          accepted_at?: string | null
          accepted_value_cents?: number | null
          accepted_version_id?: string | null
          attention?: string | null
          clarifications?: string[]
          client_notes?: string
          co_number?: number | null
          created_at?: string
          created_by?: string | null
          decided_by?: string | null
          decision_note?: string | null
          deposit?: string | null
          display?: Json | null
          document_id?: string | null
          drawing_sheet_ids?: string[]
          drawing_sheets?: string[]
          exclusions?: string[]
          id?: string
          inclusions?: string[]
          kind?: string
          number?: string
          presentation?: string
          project_id?: string
          qbo_estimate_id?: string | null
          recipients?: string[]
          revision?: number
          rollup?: Json | null
          sent_at?: string | null
          sent_by?: string | null
          snapshot?: Json | null
          status?: string
          validity_days?: number
          value_cents?: number | null
          version_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "quotes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      sheet_scales: {
        Row: {
          feet_per_point: number
          id: string
          project_id: string
          provenance: string
          region: Json | null
          set_at: string
          set_by: string | null
          sheet_id: string
        }
        Insert: {
          feet_per_point: number
          id?: string
          project_id: string
          provenance: string
          region?: Json | null
          set_at?: string
          set_by?: string | null
          sheet_id: string
        }
        Update: {
          feet_per_point?: number
          id?: string
          project_id?: string
          provenance?: string
          region?: Json | null
          set_at?: string
          set_by?: string | null
          sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_scales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sheet_scales_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          account_number: string | null
          active: boolean
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          supplies: string
        }
        Insert: {
          account_number?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          supplies?: string
        }
        Update: {
          account_number?: string | null
          active?: boolean
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          supplies?: string
        }
        Relationships: []
      }
      sync_events: {
        Row: {
          attempts: number
          created_at: string
          direction: string
          entity_id: string | null
          entity_type: string
          event_type: string
          external_id: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          payload: Json
          processed_at: string | null
          project_id: string | null
          status: string
          system: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          direction: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          project_id?: string | null
          status: string
          system?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          direction?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          project_id?: string | null
          status?: string
          system?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_links: {
        Row: {
          bmd_id: string
          external_id: string
          external_name: string | null
          id: string
          kind: string
          last_synced: Json
          linked_at: string
          synced_at: string | null
          system: string
        }
        Insert: {
          bmd_id: string
          external_id: string
          external_name?: string | null
          id?: string
          kind: string
          last_synced?: Json
          linked_at?: string
          synced_at?: string | null
          system: string
        }
        Update: {
          bmd_id?: string
          external_id?: string
          external_name?: string | null
          id?: string
          kind?: string
          last_synced?: Json
          linked_at?: string
          synced_at?: string | null
          system?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          at: string
          bmd_id: string | null
          detail: Json
          direction: string
          external_id: string | null
          id: string
          kind: string
          label: string | null
          outcome: string
          reviewed_at: string | null
          reviewed_by: string | null
          system: string
        }
        Insert: {
          at?: string
          bmd_id?: string | null
          detail?: Json
          direction: string
          external_id?: string | null
          id?: string
          kind: string
          label?: string | null
          outcome: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          system: string
        }
        Update: {
          at?: string
          bmd_id?: string | null
          detail?: Json
          direction?: string
          external_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          outcome?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          system?: string
        }
        Relationships: []
      }
      sync_outbox: {
        Row: {
          bmd_id: string
          changes: Json
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          kind: string
          label: string | null
          op: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bmd_id: string
          changes?: Json
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind: string
          label?: string | null
          op: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bmd_id?: string
          changes?: Json
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          kind?: string
          label?: string | null
          op?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_staging: {
        Row: {
          data: Json
          entity: string
          external_id: string
          kind: string
          name: string
          pulled_at: string
          system: string
        }
        Insert: {
          data?: Json
          entity: string
          external_id: string
          kind: string
          name?: string
          pulled_at?: string
          system: string
        }
        Update: {
          data?: Json
          entity?: string
          external_id?: string
          kind?: string
          name?: string
          pulled_at?: string
          system?: string
        }
        Relationships: []
      }
      takeoff_conditions: {
        Row: {
          colour: string
          created_at: string
          default_section: string | null
          finish_id: string | null
          id: string
          kind: string
          label: string
          project_id: string
          sort_order: number
        }
        Insert: {
          colour?: string
          created_at?: string
          default_section?: string | null
          finish_id?: string | null
          id?: string
          kind: string
          label: string
          project_id: string
          sort_order?: number
        }
        Update: {
          colour?: string
          created_at?: string
          default_section?: string | null
          finish_id?: string | null
          id?: string
          kind?: string
          label?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_conditions_finish_id_fkey"
            columns: ["finish_id"]
            isOneToOne: false
            referencedRelation: "project_finishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_conditions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_finish_links: {
        Row: {
          colour: string | null
          condition_key: string
          finish_id: string
          project_id: string
          variant: boolean
        }
        Insert: {
          colour?: string | null
          condition_key: string
          finish_id: string
          project_id: string
          variant?: boolean
        }
        Update: {
          colour?: string | null
          condition_key?: string
          finish_id?: string
          project_id?: string
          variant?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_finish_links_finish_id_fkey"
            columns: ["finish_id"]
            isOneToOne: false
            referencedRelation: "project_finishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_finish_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_library: {
        Row: {
          id: number
          materials: Json
          stamps: Json
          templates: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          materials?: Json
          stamps?: Json
          templates?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          materials?: Json
          stamps?: Json
          templates?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      takeoff_quantities: {
        Row: {
          border_sf: number
          condition_key: string
          ea: number
          finish_id: string
          floor_sf: number
          lf: number
          project_id: string
          section: string
          takeoff_version: number
          wall_sf: number
        }
        Insert: {
          border_sf?: number
          condition_key: string
          ea?: number
          finish_id: string
          floor_sf?: number
          lf?: number
          project_id: string
          section?: string
          takeoff_version: number
          wall_sf?: number
        }
        Update: {
          border_sf?: number
          condition_key?: string
          ea?: number
          finish_id?: string
          floor_sf?: number
          lf?: number
          project_id?: string
          section?: string
          takeoff_version?: number
          wall_sf?: number
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_quantities_finish_id_fkey"
            columns: ["finish_id"]
            isOneToOne: false
            referencedRelation: "project_finishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_quantities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_shapes: {
        Row: {
          condition_id: string
          created_at: string
          created_by: string | null
          cutouts: Json
          id: string
          kind: string
          label: string | null
          multiplier: number
          needs_checking: boolean
          openings_ft: number
          project_id: string
          qty: number
          scale_feet_per_point: number
          scale_provenance: string | null
          section: string | null
          sheet_id: string
          vertices: Json
        }
        Insert: {
          condition_id: string
          created_at?: string
          created_by?: string | null
          cutouts?: Json
          id?: string
          kind: string
          label?: string | null
          multiplier?: number
          needs_checking?: boolean
          openings_ft?: number
          project_id: string
          qty?: number
          scale_feet_per_point: number
          scale_provenance?: string | null
          section?: string | null
          sheet_id: string
          vertices: Json
        }
        Update: {
          condition_id?: string
          created_at?: string
          created_by?: string | null
          cutouts?: Json
          id?: string
          kind?: string
          label?: string | null
          multiplier?: number
          needs_checking?: boolean
          openings_ft?: number
          project_id?: string
          qty?: number
          scale_feet_per_point?: number
          scale_provenance?: string | null
          section?: string | null
          sheet_id?: string
          vertices?: Json
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_shapes_condition_id_fkey"
            columns: ["condition_id"]
            isOneToOne: false
            referencedRelation: "takeoff_conditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_shapes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeoff_shapes_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "plan_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      takeoff_sheet_labels: {
        Row: {
          label: string
          project_id: string
          sheet_key: string
          updated_at: string
        }
        Insert: {
          label: string
          project_id: string
          sheet_key: string
          updated_at?: string
        }
        Update: {
          label?: string
          project_id?: string
          sheet_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeoff_sheet_labels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_settings: {
        Row: {
          gst_pct: number
          hst_pct: number
          id: number
          pst_pct: number
          updated_at: string
        }
        Insert: {
          gst_pct?: number
          hst_pct?: number
          id?: number
          pst_pct?: number
          updated_at?: string
        }
        Update: {
          gst_pct?: number
          hst_pct?: number
          id?: number
          pst_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_access: {
        Row: {
          all_jobs: boolean
          deactivated_at: string | null
          deactivated_by: string | null
          level: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          all_jobs?: boolean
          deactivated_at?: string | null
          deactivated_by?: string | null
          level?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          all_jobs?: boolean
          deactivated_at?: string | null
          deactivated_by?: string | null
          level?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_admin_log: {
        Row: {
          action: string
          actor: string | null
          at: string
          detail: Json
          email: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          at?: string
          detail?: Json
          email?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          at?: string
          detail?: Json
          email?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          accepted_at: string | null
          all_jobs: boolean
          company: string | null
          created_at: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          invite_token: string
          invited_by: string | null
          jobs: Json
          last_error: string | null
          level: Database["public"]["Enums"]["app_role"] | null
          project_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          sent_at: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          all_jobs?: boolean
          company?: string | null
          created_at?: string
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          jobs?: Json
          last_error?: string | null
          level?: Database["public"]["Enums"]["app_role"] | null
          project_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          sent_at?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          all_jobs?: boolean
          company?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          jobs?: Json
          last_error?: string | null
          level?: Database["public"]["Enums"]["app_role"] | null
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
      visit_tasks: {
        Row: {
          created_at: string
          details: string | null
          done: boolean
          done_at: string | null
          done_by: string | null
          id: string
          project_id: string
          sort: number
          title: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          project_id: string
          sort?: number
          title: string
          visit_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          done?: boolean
          done_at?: string | null
          done_by?: string | null
          id?: string
          project_id?: string
          sort?: number
          title?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_tasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_tasks_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "install_visits"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_quote: {
        Args: { _id: string; _note?: string; _version: string }
        Returns: undefined
      }
      accept_quote_public: {
        Args: {
          _choices: Json
          _email: string
          _link: string
          _name: string
          _revision: number
          _total: number
          _value: number
          _version: string
        }
        Returns: string
      }
      active_super_count: { Args: never; Returns: number }
      add_member_by_email: {
        Args: {
          _email: string
          _project: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      admin_assert: {
        Args: {
          _new_level: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: undefined
      }
      admin_cancel_invite: { Args: { _invite: string }; Returns: undefined }
      admin_delete_user_data: { Args: { _user: string }; Returns: string }
      admin_invite: {
        Args: {
          _all_jobs: boolean
          _company: string
          _email: string
          _full_name: string
          _jobs: Json
          _level: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      admin_list_users: {
        Args: never
        Returns: {
          all_jobs: boolean
          company: string
          created_at: string
          email: string
          full_name: string
          has_records: boolean
          id: string
          invite_error: string
          invite_id: string
          invite_sent_at: string
          invite_token: string
          is_super: boolean
          job_count: number
          jobs: Json
          kind: string
          last_sign_in_at: string
          level: Database["public"]["Enums"]["app_role"]
          status: string
        }[]
      }
      admin_log: {
        Args: { _action: string; _detail: Json; _email: string; _user: string }
        Returns: undefined
      }
      admin_save_user: {
        Args: {
          _all_jobs: boolean
          _company: string
          _full_name: string
          _jobs: Json
          _level: Database["public"]["Enums"]["app_role"]
          _user: string
        }
        Returns: undefined
      }
      admin_set_status: {
        Args: { _status: string; _user: string }
        Returns: undefined
      }
      admin_user_jobs: {
        Args: { _user: string }
        Returns: {
          archived_at: string
          name: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          source: string
        }[]
      }
      admin_user_log: {
        Args: { _user: string }
        Returns: {
          action: string
          actor_name: string
          at: string
          detail: Json
        }[]
      }
      bmd_staff: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      bmd_technicians: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
        }[]
      }
      can_project_documents: {
        Args: { _project: string; _write: boolean }
        Returns: boolean
      }
      copy_estimate_version: {
        Args: { _description?: string; _from: string; _name: string }
        Returns: string
      }
      create_estimate_version: {
        Args: { _kind?: string; _name: string; _project: string }
        Returns: string
      }
      create_job: { Args: { _job: Json }; Returns: string }
      create_pipeline_project: { Args: { _p: Json }; Returns: string }
      create_progress_bill: {
        Args: {
          _kind: string
          _lines: Json
          _period_note?: string
          _project: string
        }
        Returns: string
      }
      create_project: {
        Args: { _address: string; _client: string; _name: string }
        Returns: string
      }
      create_quote: {
        Args: { _project: string; _version_ids: string[] }
        Returns: string
      }
      create_quote_link: {
        Args: { _quote: string; _token_hash: string }
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
      decline_quote: {
        Args: { _id: string; _note?: string }
        Returns: undefined
      }
      deficiency_project: { Args: { _def: string }; Returns: string }
      delete_catalogue_item: {
        Args: { _id: string; _kind: string }
        Returns: undefined
      }
      delete_estimate_line: {
        Args: { _id: string; _row_version: number }
        Returns: undefined
      }
      delete_estimate_version: { Args: { _id: string }; Returns: undefined }
      delete_quote: { Args: { _id: string }; Returns: undefined }
      document_path_project: { Args: { _name: string }; Returns: string }
      effective_role: {
        Args: { _project: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      effective_role_raw: {
        Args: { _project: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
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
      is_active: { Args: { _user_id: string }; Returns: boolean }
      is_my_assignment: {
        Args: { _assigned_to: string; _trade: string }
        Returns: boolean
      }
      is_project_member: { Args: { _project: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_role: { Args: { _user_id: string }; Returns: boolean }
      issue_quote: {
        Args: {
          _document_id: string
          _id: string
          _recipients: string[]
          _rollup: Json
          _snapshot: Json
        }
        Returns: undefined
      }
      job_people: {
        Args: { _project: string }
        Returns: {
          access: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      list_users: {
        Args: { _project: string }
        Returns: {
          access: string
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
      move_project_stage: {
        Args: {
          _note?: string
          _project: string
          _reason?: string
          _to_stage: Database["public"]["Enums"]["project_stage"]
        }
        Returns: undefined
      }
      my_projects: {
        Args: never
        Returns: {
          address: string
          archived_at: string
          client_name: string
          has_site: boolean
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
      quote_issue_block: { Args: { _id: string }; Returns: string }
      remove_member: {
        Args: { _project: string; _user_id: string }
        Returns: undefined
      }
      reset_role_permissions: { Args: never; Returns: undefined }
      retry_mirror: { Args: { _id: string }; Returns: undefined }
      revise_quote: { Args: { _id: string }; Returns: string }
      revoke_quote_link: { Args: { _quote: string }; Returns: undefined }
      role_rank: {
        Args: { _r: Database["public"]["Enums"]["app_role"] }
        Returns: number
      }
      save_estimate_line: { Args: { _p: Json }; Returns: Json }
      save_estimate_lines: { Args: { _items: Json }; Returns: Json }
      save_project_takeoff:
        | {
            Args: { _doc: Json; _expected_version: number; _project: string }
            Returns: number
          }
        | {
            Args: {
              _doc: Json
              _expected_version: number
              _project: string
              _quantities: Json
            }
            Returns: number
          }
      seed_material_orders: {
        Args: { _project: string; _version: string }
        Returns: number
      }
      set_member_role: {
        Args: {
          _company?: string
          _project: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      set_progress_bill_status: {
        Args: { _id: string; _to: string }
        Returns: undefined
      }
      set_project_holdback: {
        Args: { _pct: number; _project: string }
        Returns: undefined
      }
      set_project_job_role: {
        Args: {
          _job_role: Database["public"]["Enums"]["job_role"]
          _project: string
          _user: string
        }
        Returns: undefined
      }
      set_project_onedrive_parent: {
        Args: { _item_id: string; _path: string; _project: string }
        Returns: undefined
      }
      set_sheet_scale: {
        Args: { _feet_per_point: number; _provenance: string; _sheet: string }
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
      setup_project_site: {
        Args: { _job: Json; _project: string }
        Returns: undefined
      }
      staff_all_jobs: {
        Args: { _level: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      sync_import_apply: {
        Args: { _actions: Json; _system: string }
        Returns: Json
      }
      sync_mark_reviewed: { Args: { _id: string }; Returns: undefined }
      user_has_capability: {
        Args: { _capability: string; _user: string }
        Returns: boolean
      }
      user_has_records: { Args: { _user: string }; Returns: boolean }
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
      document_section:
        | "plans"
        | "specifications"
        | "vendor"
        | "quotes_sent"
        | "contract"
        | "photos"
        | "other"
      job_role: "estimator" | "project_lead" | "site_lead" | "other"
      location_type: "room" | "common_area"
      photo_kind: "before" | "after"
      pick_kind: "area" | "material" | "issue_type"
      project_stage:
        | "opportunity"
        | "estimating"
        | "quote_out"
        | "won"
        | "in_progress"
        | "closed"
        | "lost"
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
      document_section: [
        "plans",
        "specifications",
        "vendor",
        "quotes_sent",
        "contract",
        "photos",
        "other",
      ],
      job_role: ["estimator", "project_lead", "site_lead", "other"],
      location_type: ["room", "common_area"],
      photo_kind: ["before", "after"],
      pick_kind: ["area", "material", "issue_type"],
      project_stage: [
        "opportunity",
        "estimating",
        "quote_out",
        "won",
        "in_progress",
        "closed",
        "lost",
      ],
      responsible_party: ["bmd", "trade", "client", "unassigned"],
    },
  },
} as const
