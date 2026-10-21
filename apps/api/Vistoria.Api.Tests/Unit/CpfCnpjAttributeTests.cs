using AwesomeAssertions;
using Vistoria.Api.Infrastructure.Validation;

namespace Vistoria.Api.Tests.Unit;

public class CpfCnpjAttributeTests
{
    private static readonly CpfCnpjAttribute Attribute = new();

    [Theory]
    [InlineData("52998224725")]    // CPF
    [InlineData("11144477735")]    // CPF
    [InlineData("11222333000181")] // CNPJ numérico
    [InlineData("12ABC34501DE35")] // CNPJ alfanumérico, exemplo da Receita Federal
    public void ValidDocument_Passes(string document)
    {
        Attribute.IsValid(document).Should().BeTrue();
    }

    [Fact]
    public void Null_Passes_BecauseTheFieldIsOptional()
    {
        Attribute.IsValid(null).Should().BeTrue();
    }

    [Theory]
    [InlineData("")]
    [InlineData("52998224724")]        // CPF com o segundo verificador errado
    [InlineData("52998224715")]        // CPF com o primeiro verificador errado
    [InlineData("11111111111")]        // CPF com todos os dígitos iguais (passaria no cálculo)
    [InlineData("529.982.247-25")]     // com máscara
    [InlineData("5299822472")]         // 10 dígitos
    [InlineData("11222333000180")]     // CNPJ com verificador errado
    [InlineData("00000000000000")]     // CNPJ com todos os dígitos iguais
    [InlineData("11.222.333/0001-81")] // com máscara
    [InlineData("12abc34501de35")]     // letra minúscula
    [InlineData("12ABC34501DE3A")]     // letra na posição do verificador
    [InlineData("1144477735A")]        // letra em CPF
    [InlineData("１１１４４４７７７３５")] // dígitos que não são ASCII
    public void InvalidDocument_Fails(string document)
    {
        Attribute.IsValid(document).Should().BeFalse();
    }

    [Fact]
    public void NonString_Fails()
    {
        Attribute.IsValid(52998224725L).Should().BeFalse();
    }
}
