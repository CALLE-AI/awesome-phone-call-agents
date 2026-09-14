provider "aws" {
  region = "ap-southeast-1"
}

resource "aws_dynamodb_table" "incident_state" {
  name           = "incident-commander-state"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "timeoutAt"
    enabled        = true
  }
}
