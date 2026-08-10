require "test_helper"
require "json"

class AgentkitBootTest < ActiveSupport::TestCase
  test "boots AgentKit with safe local defaults" do
    assert_equal "CallProof", Agentkit.config.domain_name
    assert_equal :fake, Agentkit.config.llm.adapter
    assert_equal :observe, Agentkit.config.factory.mode
  end

  test "mounts the AgentKit engine" do
    mounted_engine = Rails.application.routes.routes.any? do |route|
      route.name == "agentkit"
    end

    assert mounted_engine
  end

  test "shared integration contracts contain valid JSON" do
    contracts_dir = [
      Rails.root.join("..", "contracts"),
      Rails.root.join("..", "..", "contracts")
    ].find(&:directory?)
    paths = Dir[contracts_dir.join("*.json")].sort

    assert_equal 3, paths.length
    paths.each { |path| assert_kind_of Hash, JSON.parse(File.read(path)) }
  end
end
