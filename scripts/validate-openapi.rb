#!/usr/bin/env ruby
require "yaml"

root = File.expand_path("..", __dir__)
path = File.join(root, "api", "openapi.yaml")
document = YAML.load_file(path)
problems = []

unless document["openapi"]&.start_with?("3.1.")
  problems << "OpenAPI version must be 3.1.x"
end

def walk(value, pointer = "#", &block)
  yield value, pointer
  case value
  when Hash
    value.each { |key, child| walk(child, "#{pointer}/#{key}", &block) }
  when Array
    value.each_with_index { |child, index| walk(child, "#{pointer}/#{index}", &block) }
  end
end

def resolve_pointer(document, reference)
  return nil unless reference.start_with?("#/")
  reference.delete_prefix("#/").split("/").reduce(document) do |value, segment|
    break nil unless value.is_a?(Hash)
    value[segment.gsub("~1", "/").gsub("~0", "~")]
  end
end

walk(document) do |value, pointer|
  next unless value.is_a?(Hash) && value["$ref"]
  reference = value["$ref"]
  problems << "#{pointer}: unresolved reference #{reference}" unless resolve_pointer(document, reference)
end

operation_ids = {}
http_methods = %w[get post put patch delete options head trace]
(document["paths"] || {}).each do |route, path_item|
  path_item.each do |method, operation|
    next unless http_methods.include?(method) && operation.is_a?(Hash)
    operation_id = operation["operationId"]
    if operation_id.nil? || operation_id.empty?
      problems << "#{method.upcase} #{route}: operationId is required"
    elsif operation_ids.key?(operation_id)
      problems << "#{method.upcase} #{route}: duplicate operationId #{operation_id} also used by #{operation_ids[operation_id]}"
    else
      operation_ids[operation_id] = "#{method.upcase} #{route}"
    end
    problems << "#{method.upcase} #{route}: responses are required" unless operation["responses"].is_a?(Hash)
  end
end

security_schemes = document.dig("components", "securitySchemes") || {}
walk(document["paths"] || {}) do |value, pointer|
  next unless value.is_a?(Hash) && value["security"].is_a?(Array)
  value["security"].each do |requirement|
    requirement.each_key do |scheme|
      problems << "#{pointer}: unknown security scheme #{scheme}" unless security_schemes.key?(scheme)
    end
  end
end

if problems.any?
  warn "OpenAPI validation failed:"
  problems.each { |problem| warn "- #{problem}" }
  exit 1
end

puts "OpenAPI contract valid: #{document['paths'].length} paths, #{operation_ids.length} operations, #{document.dig('components', 'schemas').length} schemas."
