export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          clinic_id: string
          created_at: string
          doctor_id: string
          duration_min: number
          id: string
          notes: string | null
          patient_id: string
          scheduled_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          doctor_id: string
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id: string
          scheduled_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          doctor_id?: string
          duration_min?: number
          id?: string
          notes?: string | null
          patient_id?: string
          scheduled_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          clinic_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip: string | null
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          clinic_id: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: string | null
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          clinic_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_doctors: {
        Row: {
          clinic_id: string
          created_at: string
          doctor_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          doctor_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          doctor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_doctors_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_doctors_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: Database["public"]["Enums"]["clinic_plan"]
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["clinic_plan"]
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["clinic_plan"]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      consents: {
        Row: {
          clinic_id: string
          created_at: string
          document_hash: string
          document_version: string
          id: string
          ip: string | null
          is_minor: boolean
          patient_id: string
          representative_document_enc: string | null
          representative_relationship: string | null
          signature_path: string | null
          signed_at: string
          signer_name: string | null
          user_agent: string | null
        }
        Insert: {
          clinic_id: string
          created_at?: string
          document_hash: string
          document_version: string
          id?: string
          ip?: string | null
          is_minor?: boolean
          patient_id: string
          representative_document_enc?: string | null
          representative_relationship?: string | null
          signature_path?: string | null
          signed_at?: string
          signer_name?: string | null
          user_agent?: string | null
        }
        Update: {
          clinic_id?: string
          created_at?: string
          document_hash?: string
          document_version?: string
          id?: string
          ip?: string | null
          is_minor?: boolean
          patient_id?: string
          representative_document_enc?: string | null
          representative_relationship?: string | null
          signature_path?: string | null
          signed_at?: string
          signer_name?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consents_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          appointment_id: string | null
          clinic_id: string
          consent_id: string | null
          created_at: string
          doctor_id: string
          ended_at: string | null
          id: string
          patient_id: string
          reason_enc: string | null
          started_at: string
          status: Database["public"]["Enums"]["consultation_status"]
          transcript_enc: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          clinic_id: string
          consent_id?: string | null
          created_at?: string
          doctor_id: string
          ended_at?: string | null
          id?: string
          patient_id: string
          reason_enc?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["consultation_status"]
          transcript_enc?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          clinic_id?: string
          consent_id?: string | null
          created_at?: string
          doctor_id?: string
          ended_at?: string | null
          id?: string
          patient_id?: string
          reason_enc?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["consultation_status"]
          transcript_enc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          appointment_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          clinic_id: string
          created_at: string
          id: string
          patient_id: string | null
          payload: Json
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          type: string
        }
        Insert: {
          appointment_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          clinic_id: string
          created_at?: string
          id?: string
          patient_id?: string | null
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type: string
        }
        Update: {
          appointment_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          clinic_id?: string
          created_at?: string
          id?: string
          patient_id?: string | null
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_progress: {
        Row: {
          clinic_id: string
          consultation_id: string | null
          created_at: string
          id: string
          metrics: Json
          notes_enc: string | null
          patient_id: string
        }
        Insert: {
          clinic_id: string
          consultation_id?: string | null
          created_at?: string
          id?: string
          metrics?: Json
          notes_enc?: string | null
          patient_id: string
        }
        Update: {
          clinic_id?: string
          consultation_id?: string | null
          created_at?: string
          id?: string
          metrics?: Json
          notes_enc?: string | null
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_progress_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_progress_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_progress_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          birth_date: string | null
          clinic_id: string
          created_at: string
          created_by: string | null
          document_enc: string | null
          email_enc: string | null
          emergency_contact_name_enc: string | null
          emergency_contact_phone_enc: string | null
          emergency_contact_relationship_enc: string | null
          full_name_enc: string
          gender: string | null
          history_enc: string | null
          id: string
          notes_enc: string | null
          phone_enc: string | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          clinic_id: string
          created_at?: string
          created_by?: string | null
          document_enc?: string | null
          email_enc?: string | null
          emergency_contact_name_enc?: string | null
          emergency_contact_phone_enc?: string | null
          emergency_contact_relationship_enc?: string | null
          full_name_enc: string
          gender?: string | null
          history_enc?: string | null
          id?: string
          notes_enc?: string | null
          phone_enc?: string | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          document_enc?: string | null
          email_enc?: string | null
          emergency_contact_name_enc?: string | null
          emergency_contact_phone_enc?: string | null
          emergency_contact_relationship_enc?: string | null
          full_name_enc?: string
          gender?: string | null
          history_enc?: string | null
          id?: string
          notes_enc?: string | null
          phone_enc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      psychometric_assessments: {
        Row: {
          administered_at: string
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          patient_id: string
          payload_enc: string
          type: string
        }
        Insert: {
          administered_at?: string
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id: string
          payload_enc: string
          type: string
        }
        Update: {
          administered_at?: string
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id?: string
          payload_enc?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "psychometric_assessments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "psychometric_assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "psychometric_assessments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          clinic_id: string
          consultation_id: string
          created_at: string
          doctor_edited: boolean
          doctor_notes_enc: string | null
          id: string
          patient_id: string
          payload_enc: string
          pdf_path: string | null
          updated_at: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          clinic_id: string
          consultation_id: string
          created_at?: string
          doctor_edited?: boolean
          doctor_notes_enc?: string | null
          id?: string
          patient_id: string
          payload_enc: string
          pdf_path?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          clinic_id?: string
          consultation_id?: string
          created_at?: string
          doctor_edited?: boolean
          doctor_notes_enc?: string | null
          id?: string
          patient_id?: string
          payload_enc?: string
          pdf_path?: string | null
          updated_at?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      soap_notes: {
        Row: {
          assessment_enc: string | null
          clinic_id: string
          consultation_id: string
          created_at: string
          created_by: string | null
          id: string
          objective_enc: string | null
          patient_id: string
          plan_enc: string | null
          subjective_enc: string | null
          updated_at: string
        }
        Insert: {
          assessment_enc?: string | null
          clinic_id: string
          consultation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          objective_enc?: string | null
          patient_id: string
          plan_enc?: string | null
          subjective_enc?: string | null
          updated_at?: string
        }
        Update: {
          assessment_enc?: string | null
          clinic_id?: string
          consultation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          objective_enc?: string | null
          patient_id?: string
          plan_enc?: string | null
          subjective_enc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "soap_notes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soap_notes_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: true
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soap_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soap_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_chunks: {
        Row: {
          clinic_id: string
          confidence: number | null
          consultation_id: string
          created_at: string
          id: string
          is_final: boolean
          seq: number
          speaker: string | null
          text_enc: string
          ts_ms: number | null
        }
        Insert: {
          clinic_id: string
          confidence?: number | null
          consultation_id: string
          created_at?: string
          id?: string
          is_final?: boolean
          seq: number
          speaker?: string | null
          text_enc: string
          ts_ms?: number | null
        }
        Update: {
          clinic_id?: string
          confidence?: number | null
          consultation_id?: string
          created_at?: string
          id?: string
          is_final?: boolean
          seq?: number
          speaker?: string | null
          text_enc?: string
          ts_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transcript_chunks_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_chunks_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plan_items: {
        Row: {
          clinic_id: string
          completed_at: string | null
          created_at: string
          description_enc: string
          id: string
          order_index: number
          plan_id: string
          status: string
          target_date: string | null
          type: string
        }
        Insert: {
          clinic_id: string
          completed_at?: string | null
          created_at?: string
          description_enc: string
          id?: string
          order_index?: number
          plan_id: string
          status?: string
          target_date?: string | null
          type: string
        }
        Update: {
          clinic_id?: string
          completed_at?: string | null
          created_at?: string
          description_enc?: string
          id?: string
          order_index?: number
          plan_id?: string
          status?: string
          target_date?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plan_items_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "treatment_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_plans: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string | null
          id: string
          patient_id: string
          status: string
          title_enc: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id: string
          status?: string
          title_enc: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          patient_id?: string
          status?: string
          title_enc?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatment_plans_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatment_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          clinic_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          email: string
          full_name: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_clinic_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      create_clinic_and_admin: {
        Args: { clinic_name: string; full_name: string }
        Returns: string
      }
      get_platform_clinic_overview: {
        Args: never
        Returns: {
          clinic_id: string
          clinic_name: string
          consultation_count: number
          created_at: string
          doctor_count: number
          patient_count: number
          plan: string
          slug: string
        }[]
      }
      is_platform_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      clinic_plan: "free" | "pro" | "clinica" | "enterprise"
      consultation_status: "in_progress" | "ended" | "analyzed"
      notification_channel: "email" | "whatsapp"
      notification_status: "pending" | "sent" | "failed"
      user_role: "admin" | "doctor" | "secretaria" | "paciente"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      appointment_status: [
        "scheduled",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      clinic_plan: ["free", "pro", "clinica", "enterprise"],
      consultation_status: ["in_progress", "ended", "analyzed"],
      notification_channel: ["email", "whatsapp"],
      notification_status: ["pending", "sent", "failed"],
      user_role: ["admin", "doctor", "secretaria", "paciente"],
    },
  },
} as const

