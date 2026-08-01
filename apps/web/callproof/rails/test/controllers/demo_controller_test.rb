require "test_helper"

class DemoControllerTest < ActionDispatch::IntegrationTest
  test "renders the safe demo" do
    get root_path

    assert_response :success
    assert_select "h1", text: /Phone agents with verifiable outcomes/
    assert_select "form[action='#{demo_calls_path}']"
  end

  test "creates and displays a no-call simulation" do
    assert_difference "CallRequest.count", 1 do
      post demo_calls_path, params: {
        call_request: {
          objective: "Move fictional order C1023 to Friday without exceeding $250.",
          simulation_scenario: "policy_violation"
        }
      }
    end

    request = CallRequest.order(:id).last
    assert_redirected_to call_request_path(request)

    follow_redirect!
    assert_response :success
    assert_select "h1", text: "Waiting human"
    assert_select "a", text: "Open human review"
    assert_equal false, request.live_mode
  end
end
