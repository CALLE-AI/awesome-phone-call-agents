using CareCall.Core.Domain;
using CareCall.Core.Services;

namespace CareCall.Tests;

public class AssessmentParserTests
{
    [Fact]
    public void TryParse_PlainJson_Succeeds()
    {
        var raw = """
            {"symptoms":["tos","fiebre"],"riskClassification":"High","summary":"Empeora.","worseningDetected":true}
            """;

        Assert.True(AssessmentParser.TryParse(raw, out var dto));
        Assert.Equal(["tos", "fiebre"], dto.Symptoms);
        Assert.Equal(RiskLevel.High, dto.RiskClassification);
        Assert.True(dto.WorseningDetected);
    }

    [Fact]
    public void TryParse_MarkdownFencedJson_Succeeds()
    {
        var raw = """
            Claro, aqui tienes el analisis:

            ```json
            {"symptoms":["mareo"],"riskClassification":"Medium","summary":"Estable.","worseningDetected":false}
            ```
            """;

        Assert.True(AssessmentParser.TryParse(raw, out var dto));
        Assert.Equal(RiskLevel.Medium, dto.RiskClassification);
        Assert.Single(dto.Symptoms);
    }

    [Fact]
    public void TryParse_NestedBracesInsideStrings_Succeeds()
    {
        var raw = """
            {"symptoms":["dolor {intenso}"],"riskClassification":"low","summary":"Texto con \"comillas\" y }.","worseningDetected":false}
            """;

        Assert.True(AssessmentParser.TryParse(raw, out var dto));
        Assert.Equal(RiskLevel.Low, dto.RiskClassification);
        Assert.Equal("dolor {intenso}", dto.Symptoms[0]);
    }

    [Theory]
    [InlineData("Low", RiskLevel.Low)]
    [InlineData("bajo", RiskLevel.Low)]
    [InlineData("MEDIUM", RiskLevel.Medium)]
    [InlineData("moderado", RiskLevel.Medium)]
    [InlineData("alta", RiskLevel.High)]
    [InlineData("critical", RiskLevel.High)]
    [InlineData("2", RiskLevel.High)]
    [InlineData("0", RiskLevel.Low)]
    public void MapRisk_AcceptsCommonVariants(string input, RiskLevel expected)
        => Assert.Equal(expected, AssessmentParser.MapRisk(input));

    [Fact]
    public void MapRisk_UnknownValue_DoesNotUnderestimate()
        => Assert.Equal(RiskLevel.Medium, AssessmentParser.MapRisk("no lo se"));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Lo siento, no puedo ayudarte con eso.")]
    [InlineData("{\"symptoms\": [")]
    public void TryParse_InvalidInput_Fails(string? raw)
        => Assert.False(AssessmentParser.TryParse(raw, out _));
}
