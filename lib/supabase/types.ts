export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      clips: {
        Row: {
          bgm_url: string | null
          bgm_volume: number
          bgm_start_sec: number | null
          created_at: string | null
          end_sec: number
          id: string
          label: string | null
          original_volume: number
          project_id: string | null
          render_error: string | null
          render_path: string | null
          render_progress: number
          render_status: string | null
          start_sec: number
          subtitle_style: Json | null
          comment_style: Json | null
          template_id: string | null
          transcribe_status: string | null
        }
        Insert: {
          bgm_url?: string | null
          bgm_volume?: number
          bgm_start_sec?: number | null
          created_at?: string | null
          end_sec: number
          id?: string
          label?: string | null
          original_volume?: number
          project_id?: string | null
          render_error?: string | null
          render_path?: string | null
          render_progress?: number
          render_status?: string | null
          start_sec: number
          subtitle_style?: Json | null
          comment_style?: Json | null
          template_id?: string | null
          transcribe_status?: string | null
        }
        Update: {
          bgm_url?: string | null
          bgm_volume?: number
          bgm_start_sec?: number | null
          created_at?: string | null
          end_sec?: number
          id?: string
          label?: string | null
          original_volume?: number
          project_id?: string | null
          render_error?: string | null
          render_path?: string | null
          render_progress?: number
          render_status?: string | null
          start_sec?: number
          subtitle_style?: Json | null
          comment_style?: Json | null
          template_id?: string | null
          transcribe_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'clips_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      comments: {
        Row: {
          body: string
          clip_id: string | null
          id: string
          is_selected: boolean
          likes_count: number | null
          source: string | null
          username: string
        }
        Insert: {
          body: string
          clip_id?: string | null
          id?: string
          is_selected?: boolean
          likes_count?: number | null
          source?: string | null
          username: string
        }
        Update: {
          body?: string
          clip_id?: string | null
          id?: string
          is_selected?: boolean
          likes_count?: number | null
          source?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comments_clip_id_fkey'
            columns: ['clip_id']
            isOneToOne: false
            referencedRelation: 'clips'
            referencedColumns: ['id']
          },
        ]
      }
      lyrics_segments: {
        Row: {
          clip_id: string | null
          end_sec: number
          id: string
          order: number
          start_sec: number
          text: string
        }
        Insert: {
          clip_id?: string | null
          end_sec: number
          id?: string
          order?: number
          start_sec: number
          text: string
        }
        Update: {
          clip_id?: string | null
          end_sec?: number
          id?: string
          order?: number
          start_sec?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: 'lyrics_segments_clip_id_fkey'
            columns: ['clip_id']
            isOneToOne: false
            referencedRelation: 'clips'
            referencedColumns: ['id']
          },
        ]
      }
      projects: {
        Row: {
          artist: string
          created_at: string | null
          id: string
          import_error: string | null
          import_status: string | null
          ip_confirmed_at: string | null
          ip_owner: boolean
          song_lyrics: string | null
          song_lyrics_timestamps: Json | null
          song_title: string
          source_url: string
          yt_duration_sec: number | null
          yt_source_path: string | null
          yt_thumbnail_url: string | null
          yt_title: string | null
          yt_video_id: string | null
        }
        Insert: {
          artist: string
          created_at?: string | null
          id?: string
          import_error?: string | null
          import_status?: string | null
          ip_confirmed_at?: string | null
          ip_owner?: boolean
          song_lyrics?: string | null
          song_lyrics_timestamps?: Json | null
          song_title: string
          source_url: string
          yt_duration_sec?: number | null
          yt_source_path?: string | null
          yt_thumbnail_url?: string | null
          yt_title?: string | null
          yt_video_id?: string | null
        }
        Update: {
          artist?: string
          created_at?: string | null
          id?: string
          import_error?: string | null
          import_status?: string | null
          ip_confirmed_at?: string | null
          ip_owner?: boolean
          song_lyrics?: string | null
          song_lyrics_timestamps?: Json | null
          song_title?: string
          source_url?: string
          yt_duration_sec?: number | null
          yt_source_path?: string | null
          yt_thumbnail_url?: string | null
          yt_title?: string | null
          yt_video_id?: string | null
        }
        Relationships: []
      }
      templates: {
        Row: {
          config_json: Json
          id: string
          name: string
        }
        Insert: {
          config_json: Json
          id?: string
          name: string
        }
        Update: {
          config_json?: Json
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
