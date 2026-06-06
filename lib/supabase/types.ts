export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      clips: {
        Row: {
          bar_enabled: boolean
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
          render_preset: string | null
          render_progress: number
          render_status: string | null
          start_sec: number
          subtitle_style: Json | null
          comment_style: Json | null
          template_id: string | null
        }
        Insert: {
          bar_enabled?: boolean
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
          render_preset?: string | null
          render_progress?: number
          render_status?: string | null
          start_sec: number
          subtitle_style?: Json | null
          comment_style?: Json | null
          template_id?: string | null
        }
        Update: {
          bar_enabled?: boolean
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
          render_preset?: string | null
          render_progress?: number
          render_status?: string | null
          start_sec?: number
          subtitle_style?: Json | null
          comment_style?: Json | null
          template_id?: string | null
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
      text_overlays: {
        Row: {
          align: string
          clip_id: string | null
          color: string
          content: string
          created_at: string | null
          effect: string
          end_sec: number | null
          font_key: string
          id: string
          rotation: number
          size: number
          start_sec: number | null
          x: number
          y: number
          z_index: number
          zone: string
        }
        Insert: {
          align?: string
          clip_id?: string | null
          color?: string
          content?: string
          created_at?: string | null
          effect?: string
          end_sec?: number | null
          font_key?: string
          id?: string
          rotation?: number
          size?: number
          start_sec?: number | null
          x?: number
          y?: number
          z_index?: number
          zone: string
        }
        Update: {
          align?: string
          clip_id?: string | null
          color?: string
          content?: string
          created_at?: string | null
          effect?: string
          end_sec?: number | null
          font_key?: string
          id?: string
          rotation?: number
          size?: number
          start_sec?: number | null
          x?: number
          y?: number
          z_index?: number
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: 'text_overlays_clip_id_fkey'
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
          description_base: string | null
          description_styled: string | null
          description_tone: string | null
          id: string
          import_error: string | null
          import_status: string | null
          ip_confirmed_at: string | null
          ip_owner: boolean
          owner_uid: string
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
          description_base?: string | null
          description_styled?: string | null
          description_tone?: string | null
          id?: string
          import_error?: string | null
          import_status?: string | null
          ip_confirmed_at?: string | null
          ip_owner?: boolean
          owner_uid: string
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
          description_base?: string | null
          description_styled?: string | null
          description_tone?: string | null
          id?: string
          import_error?: string | null
          import_status?: string | null
          ip_confirmed_at?: string | null
          ip_owner?: boolean
          owner_uid?: string
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
      tone_presets: {
        Row: {
          description: string
          id: string
          is_active: boolean | null
          key: string
          label: string
          reference_text: string | null
          updated_at: string | null
        }
        Insert: {
          description: string
          id?: string
          is_active?: boolean | null
          key: string
          label: string
          reference_text?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string
          id?: string
          is_active?: boolean | null
          key?: string
          label?: string
          reference_text?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      track_recommendations: {
        Row: {
          artist: string
          batch_id: string
          created_at: string | null
          era: string | null
          genre: string | null
          genre_filter: string | null
          id: string
          owner_uid: string
          popularity_estimate: number | null
          rank: number | null
          reason: string | null
          release_year: number | null
          role: string | null
          song_title: string
          topic: string | null
          used: boolean | null
          used_project_id: string | null
          yt_search_status: string | null
          yt_title: string | null
          yt_video_id: string | null
        }
        Insert: {
          artist: string
          batch_id: string
          created_at?: string | null
          era?: string | null
          genre?: string | null
          genre_filter?: string | null
          id?: string
          owner_uid: string
          popularity_estimate?: number | null
          rank?: number | null
          reason?: string | null
          release_year?: number | null
          role?: string | null
          song_title: string
          topic?: string | null
          used?: boolean | null
          used_project_id?: string | null
          yt_search_status?: string | null
          yt_title?: string | null
          yt_video_id?: string | null
        }
        Update: {
          artist?: string
          batch_id?: string
          created_at?: string | null
          era?: string | null
          genre?: string | null
          genre_filter?: string | null
          id?: string
          owner_uid?: string
          popularity_estimate?: number | null
          rank?: number | null
          reason?: string | null
          release_year?: number | null
          role?: string | null
          song_title?: string
          topic?: string | null
          used?: boolean | null
          used_project_id?: string | null
          yt_search_status?: string | null
          yt_title?: string | null
          yt_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'track_recommendations_used_project_id_fkey'
            columns: ['used_project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
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
