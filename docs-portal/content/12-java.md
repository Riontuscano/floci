---
title: Java / Spring Boot
section: Language Guides
order: 12
summary: AWS SDK for Java v2 and Spring Boot configuration for Floci.
---

# Java / Spring Boot

## Dependencies (Maven)

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>software.amazon.awssdk</groupId>
      <artifactId>bom</artifactId>
      <version>2.31.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>s3</artifactId>
  </dependency>
  <dependency>
    <groupId>software.amazon.awssdk</groupId>
    <artifactId>sqs</artifactId>
  </dependency>
</dependencies>
```

## Plain SDK v2

```java
var endpoint = System.getenv().getOrDefault("AWS_ENDPOINT_URL", "http://localhost:4566");

S3Client s3 = S3Client.builder()
    .endpointOverride(URI.create(endpoint))
    .region(Region.US_EAST_1)
    .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
    .forcePathStyle(true)
    .build();

s3.createBucket(b -> b.bucket("uploads"));
s3.putObject(b -> b.bucket("uploads").key("hello.txt"), RequestBody.fromString("hi"));
```

Recent SDK v2 releases also honor `AWS_ENDPOINT_URL` on their own, so `S3Client.create()` works if the environment is set and you only need `forcePathStyle` for S3.

## Spring Boot configuration

```yaml
# application-local.yml
aws:
  endpoint: http://localhost:4566
  region: us-east-1
```

```java
@Configuration
public class AwsConfig {

    @Bean
    S3Client s3Client(@Value("${aws.endpoint:}") String endpoint,
                      @Value("${aws.region:us-east-1}") String region) {
        var builder = S3Client.builder().region(Region.of(region));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint))
                   .forcePathStyle(true)
                   .credentialsProvider(StaticCredentialsProvider.create(
                       AwsBasicCredentials.create("test", "test")));
        }
        return builder.build();
    }
}
```

Run with `SPRING_PROFILES_ACTIVE=local` locally and leave `aws.endpoint` empty in production.

### Spring Cloud AWS

```yaml
spring:
  cloud:
    aws:
      endpoint: http://localhost:4566
      region:
        static: us-east-1
      credentials:
        access-key: test
        secret-key: test
      s3:
        path-style-access-enabled: true
```

## Testcontainers (JUnit 5)

```java
@Testcontainers
class OrderServiceTest {

    @Container
    static FlociContainer floci = new FlociContainer();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("aws.endpoint", floci::getEndpoint);
    }
}
```

```xml
<dependency>
  <groupId>io.floci</groupId>
  <artifactId>testcontainers-floci</artifactId>
  <version>1.14.0</version> <!-- 2.15.0 for Testcontainers 2.x / Spring Boot 4 -->
  <scope>test</scope>
</dependency>
```

`FlociContainer` lives in `io.floci.testcontainers`. See the [Floci Java Testcontainers docs](https://floci.io/floci/testcontainers/java/) for more examples.
