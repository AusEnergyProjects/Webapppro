Pod::Spec.new do |s|
  s.name = 'TLinkCalls'
  s.version = '1.0.0'
  s.summary = 'TLink native incoming and ongoing calls'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Australian Energy Assessments'
  s.homepage = 'https://ausenergyassessments.com'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'react-native-webrtc'
  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'CallKit', 'PushKit', 'AVFoundation'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
