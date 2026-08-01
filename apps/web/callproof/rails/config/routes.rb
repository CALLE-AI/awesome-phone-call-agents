Rails.application.routes.draw do
  mount Agentkit::Engine => "/agentkit"
  root "demo#index"
  post "demo/calls", to: "demo#create", as: :demo_calls
  post "webhooks/call_analyzer", to: "call_analyzer_webhooks#create"
  resources :live_calls, only: %i[new create show] do
    member do
      post :confirm
      post :cancel
    end
  end
  resources :call_requests, only: :show
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  # Defines the root path route ("/")
  # root "posts#index"
end
